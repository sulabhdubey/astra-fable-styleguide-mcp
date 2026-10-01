/* global document, getComputedStyle */
import { createHash } from 'node:crypto';
import {TextDecoder} from 'node:util';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContract, evaluateObservations } from '../packages/browser-verification/src/index.mjs';
import { loadPinnedConstitution } from './constitution.mjs';
import { collectUiObservations } from './browser-journey.mjs';
import { evaluateDesignObservations } from './design-observations.mjs';
import {parseRepairStylesheet,observeRepairCandidates} from './running-repair-map.mjs';
import { canonicalize, flattenTokenLeaves, mergeObjects, resolveToken } from '../dist/packages/style-spec/src/index.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const selector = value => typeof value === 'string' && /^#[A-Za-z][\w-]*$/.test(value);
const safeDirectory = value => typeof value === 'string' && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value);
const safeFile = value => typeof value === 'string' && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value) && !value.split('/').some(part => part === '..');
const tokenPath = value => typeof value === 'string' && /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/.test(value);

async function contained(root, path, type) {
  const full = await realpath(resolve(root, path)); const rel = relative(root, full).replaceAll('\\', '/');
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.toLowerCase() !== path.toLowerCase()) throw new Error('Unsafe project path or symlink');
  const info = await stat(full); if ((type === 'directory' && !info.isDirectory()) || (type === 'file' && !info.isFile())) throw new Error('Unsupported project path');
  return full;
}
async function snapshotDirectory(root, configured, label) {
  if (!safeDirectory(configured)) throw new Error('Unsafe project directory');
  const base = await contained(root, configured, 'directory'); const files = {};
  async function visit(current, relativePath = '', depth = 0) {
    if (depth > 8) throw new Error('Project directory nesting is unsupported');
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error('Project symlinks are unsupported');
      const next = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(full, next, depth + 1);
      else if (entry.isFile()) {
        const info = await stat(full); if (info.size > 2_000_000 || Object.keys(files).length >= 300) throw new Error('Running project is too large');
        files[`${label}/${configured}/${next}`] = digest(await readFile(full));
      } else throw new Error('Unsupported project entry');
    }
  }
  await visit(base); return files;
}
export async function snapshotRunningProject(project) {
  if (digest(await readFile(project.configPath)) !== project.configHash) throw new Error('Configuration changed; reload project');
  const files = { ...(await snapshotDirectory(project.root, project.config.sourceDirectory, 'source')), ...(await snapshotDirectory(project.root, project.config.buildDirectory, 'build')) };
  for (const path of project.config.identityFiles) {
    if (!safeFile(path)) throw new Error('Unsafe identity file');
    const full = await contained(project.root, path, 'file'); const info = await stat(full); if (info.size > 1_000_000) throw new Error('Identity file too large');
    files[`identity/${path}`] = digest(await readFile(full));
  }
  if (project.config.constitution) {
    const path = project.config.constitution.path;
    if (!safeFile(path)) throw new Error('Unsafe constitution identity file');
    const full = await contained(project.root, path, 'file');
    files[`identity/${path}`] = digest(await readFile(full));
  }
  return { files, sha256: digest(JSON.stringify(files)), scope: 'SHA-256 of configured source, build and identity-file bytes' };
}
async function canonicalFiles(root, prefix = '') {
  const files = {};
  for (const entry of (await readdir(resolve(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error('Canonical constitution symlinks are unsupported');
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) Object.assign(files, await canonicalFiles(root, `${name}/`));
    else if (entry.isFile() && name.endsWith('.json')) files[name] = JSON.parse(await readFile(resolve(root, name), 'utf8'));
  }
  return files;
}
async function bundledConstitution() {
  const files = await canonicalFiles(resolve(repository, 'spec'));
  const [button, dialog, rules, manifest] = ['components/button.json', 'components/dialog.json', 'accessibility/rules.json', 'manifest.json'].map(path => files[path]);
  const rawTokens = {};
  for (const path of Object.keys(files).filter(path => path.startsWith('tokens/')).sort()) mergeObjects(rawTokens, files[path]);
  const tokens = Object.fromEntries(flattenTokenLeaves(rawTokens).map(({ path }) => [path, resolveToken(rawTokens, path)]));
  const base = createContract({ button, dialog, rules });
  const sha256 = digest(Buffer.from(`${canonicalize({ schemaVersion: 1, files })}\n`));
  return { contract: { ...base, specSha256: sha256, specHashScope: 'SHA-256 of the complete bundled canonical snapshot', constitution: { name: manifest.name, version: manifest.version, sha256, scope: 'complete bundled canonical snapshot' } }, tokens, rules };
}
function cssTokens(css) {
  return Object.fromEntries([...css.matchAll(/--([A-Za-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => {
    const token = value.trim(); return [name.replace(/-([A-Z])/g, '.$1').replaceAll('-', '.'), /^\d+(?:\.\d+)?$/.test(token) ? Number(token) : token];
  }));
}
function expectedMeasurement(value, tokens, rules) {
  const expected = { typography: {}, spacing: {} };
  for (const group of ['typography', 'spacing']) for (const [property, path] of Object.entries(value[group] ?? {})) {
    if (!tokenPath(path) || !(path in tokens)) throw new Error('Measurement must reference a canonical token');
    expected[group][property] = tokens[path];
  }
  if (value.contrast) {
    const { foreground, background } = value.contrast;
    if (!tokenPath(foreground) || !tokenPath(background) || !(foreground in tokens) || !(background in tokens)) throw new Error('Contrast must reference canonical tokens');
    const rule = rules.contrastPairs?.find(pair => pair.foreground === foreground && pair.background === background);
    if (!rule) throw new Error('Contrast must match a canonical contrast pair');
    expected.contrast = { foreground: tokens[foreground], background: tokens[background], minimum: rule.minimum, ruleId: rule.id };
  }
  return expected;
}

export async function loadRunningProject(configPath) {
  const full = await realpath(configPath); const root = await realpath(dirname(full)); const raw = await readFile(full, 'utf8');
  if (raw.length > 32_000) throw new Error('Configuration too large'); const config = JSON.parse(raw);
  if (Object.keys(config).some(key => !['schemaVersion', 'integration', 'url', 'sourceDirectory', 'buildDirectory', 'identityFiles', 'journey', 'targetPaths', 'measurements', 'constitution', 'repairStylesheets'].includes(key))) throw new Error('Unknown running project configuration field');
  const url = new URL(config.url);
  if (config.schemaVersion !== 2 || config.integration !== 'vite-preview' || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Only an explicit loopback Vite preview origin is allowed');
  if (!safeDirectory(config.sourceDirectory) || !safeDirectory(config.buildDirectory) || config.sourceDirectory === config.buildDirectory || !Array.isArray(config.identityFiles) || !config.identityFiles.length || config.identityFiles.length > 10 || new Set(config.identityFiles).size !== config.identityFiles.length) throw new Error('Invalid running project identity');
  const sourceName=config.sourceDirectory.toLowerCase(),buildName=config.buildDirectory.toLowerCase();
  if(sourceName===buildName||sourceName.startsWith(buildName+'/')||buildName.startsWith(sourceName+'/'))throw new Error('Source and build directories must not overlap');
  if(new Set(config.identityFiles.map(path=>String(path).toLowerCase())).size!==config.identityFiles.length||config.identityFiles.some(path=>typeof path!=='string'||[sourceName,buildName].some(directory=>path.toLowerCase()===directory||path.toLowerCase().startsWith(directory+'/'))))throw new Error('Identity files must be unique and outside source/build directories');
  const journey = config.journey;
  if (!journey || Object.keys(journey).some(key => !['buttons', 'trigger', 'dialog', 'name', 'dialogButtons', 'close', 'escapeAllowed', 'exceptionReason'].includes(key)) || !Array.isArray(journey.buttons) || !Array.isArray(journey.dialogButtons) || !journey.buttons.length || !journey.dialogButtons.length || [...journey.buttons, ...journey.dialogButtons, journey.trigger, journey.dialog, journey.close].some(value => !selector(value)) || !journey.buttons.includes(journey.trigger) || !journey.dialogButtons.includes(journey.close) || typeof journey.name !== 'string' || !journey.name.trim()) throw new Error('Invalid configured journey');
  if (!config.targetPaths || typeof config.targetPaths !== 'object' || Array.isArray(config.targetPaths)) throw new Error('Invalid target paths');
  const targets = [...journey.buttons, ...journey.dialogButtons, 'dialog', 'page'];
  if (!Array.isArray(config.measurements) || !config.measurements.length || config.measurements.length > 20) throw new Error('Invalid measurements');
  for (const measurement of config.measurements) {
    const typography = measurement?.typography; const spacing = measurement?.spacing; const contrast = measurement?.contrast;
    if (!measurement || Object.keys(measurement).some(key => !['selector', 'target', 'typography', 'spacing', 'contrast'].includes(key)) || !selector(measurement.selector) || !selector(measurement.target) || (!typography && !spacing && !contrast) ||
      (typography && (typeof typography !== 'object' || Object.keys(typography).some(key => !['fontFamily', 'fontSize', 'lineHeight'].includes(key)))) ||
      (spacing && (typeof spacing !== 'object' || Object.keys(spacing).some(key => key !== 'paddingTop'))) ||
      (contrast && (typeof contrast !== 'object' || Object.keys(contrast).some(key => !['foreground', 'background'].includes(key))))) throw new Error('Invalid measurement');
    targets.push(measurement.target);
  }
  for (const target of targets) {
    const path = config.targetPaths[target];
    if (!safeFile(path) || !path.startsWith(`${config.sourceDirectory}/`)) throw new Error('Unsafe target source mapping');
    await contained(root, path, 'file');
  }
  const project = { root, configPath: full, config, configHash: digest(Buffer.from(raw)) };
  let constitution;
  if (config.constitution) {
    const pinned = await loadPinnedConstitution(root, config.constitution);
    const bundle = JSON.parse(await readFile(resolve(root, config.constitution.path), 'utf8'));
    constitution = { contract: pinned.contract, tokens: cssTokens(pinned.css), rules: bundle.files?.['accessibility/rules.json'] };
  } else constitution = await bundledConstitution();
  const measurements = config.measurements.map(value => ({ ...value, expected: expectedMeasurement(value, constitution.tokens, constitution.rules ?? { contrastPairs: [] }) }));
  project.contract = constitution.contract; project.measurements = measurements; project.identity = { before: await snapshotRunningProject(project) };
  project.repairStylesheets=[];
  if(config.repairStylesheets!==undefined) {
    if(!Array.isArray(config.repairStylesheets)||!config.repairStylesheets.length||config.repairStylesheets.length>10)throw new Error('Invalid repair stylesheets');
    const sources=new Set(),builds=new Set();
    for(const mapping of config.repairStylesheets) {
      if(!mapping||Object.keys(mapping).some(key=>!['source','build'].includes(key))||!safeFile(mapping.source)||!safeFile(mapping.build)||!mapping.source.startsWith(`${config.sourceDirectory}/`)||!mapping.source.endsWith('.css')||!mapping.build.endsWith('.css')||sources.has(mapping.source.toLowerCase())||builds.has(mapping.build.toLowerCase()))throw new Error('Invalid repair stylesheet mapping');
      sources.add(mapping.source.toLowerCase());builds.add(mapping.build.toLowerCase());
      if(!Object.hasOwn(project.identity.before.files,`source/${mapping.source}`)||!Object.hasOwn(project.identity.before.files,`build/${config.buildDirectory}/${mapping.build}`))throw new Error('Repair mapping must use exact snapshot path casing');
      const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await readFile(await contained(root,mapping.source,'file')));
      const rules=parseRepairStylesheet(text);
      const built=await readFile(await contained(root,`${config.buildDirectory}/${mapping.build}`,'file'));
      project.repairStylesheets.push({...mapping,text,rules,buildMatches:Buffer.from(text).equals(built)});
    }
  }
  return project;
}

function connectedTab(page) {
  const snapshot = () => page.locator('body').ariaSnapshot();
  return { pressKey: (_target, key) => page.keyboard.press(key.replace('shift+', 'Shift+')), getAXState: snapshot,
    playwright: { locator: selectorValue => page.locator(selectorValue), getByRole: (role, options) => page.getByRole(role, options), evaluate: (fn, argument) => page.evaluate(fn, argument), domSnapshot: snapshot } };
}
export function allowedRunningRequest(origin, url, method, buildPaths) {
  try {
    const target = new URL(url); const path = target.pathname === '/' ? '/index.html' : target.pathname;
    return method === 'GET' && target.origin === origin && !target.username && !target.password && target.search === '' && buildPaths instanceof Set && buildPaths.has(path);
  } catch { return false; }
}
async function collectMeasurements(page, measurements) {
  return page.evaluate(items => items.map(item => {
    const matches = [...document.querySelectorAll(item.selector)]; const viewport = { width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth };
    if (matches.length > 1) throw new Error(`Configured measurement selector must match exactly one element: ${item.selector}`);
    const element = matches[0]; if (!element) return { ...item, found: false, observed: {}, viewport };
    const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); const visible = rect.width > 0 && rect.height > 0 && style.visibility === 'visible' && Number(style.opacity) > 0;
    if (!visible) return { ...item, found: false, observed: {}, viewport };
    let parent = element; let backgroundColor = 'transparent'; let backgroundImage = 'none'; let composited = false;
    while (parent) {
      const parentStyle = getComputedStyle(parent);
      if (backgroundImage === 'none' && parentStyle.backgroundImage !== 'none') backgroundImage = parentStyle.backgroundImage;
      if ((backgroundColor === 'rgba(0, 0, 0, 0)' || backgroundColor === 'transparent') && parentStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' && parentStyle.backgroundColor !== 'transparent') backgroundColor = parentStyle.backgroundColor;
      if (Number(parentStyle.opacity) !== 1 || parentStyle.filter !== 'none' || parentStyle.backdropFilter !== 'none' || parentStyle.mixBlendMode !== 'normal' || parentStyle.backgroundBlendMode !== 'normal') composited = true;
      parent = parent.parentElement;
    }
    return { ...item, found: true, observed: { fontFamily: style.fontFamily, fontSize: style.fontSize, parentFontSize: element.parentElement ? getComputedStyle(element.parentElement).fontSize : null, rootFontSize: getComputedStyle(document.documentElement).fontSize, lineHeight: style.lineHeight, paddingTop: style.paddingTop, color: style.color, backgroundColor, backgroundImage, composited }, viewport };
  }), measurements);
}
function reportStatus(checks) { return checks.some(check => check.status === 'fail') ? 'fail' : checks.every(check => check.status === 'pass') ? 'pass' : 'not_checked'; }

export async function runRunningCheck(configPath, { launch } = {}) {
  const project = await loadRunningProject(configPath); const start = launch ?? (async () => { const { chromium } = await import('playwright'); return chromium.launch({ headless: true }); });
  if(project.repairStylesheets.some(sheet=>!sheet.buildMatches))throw new Error('Mapped stylesheet differs from source; rebuild the trusted Vite project before checking');
  const browser = await start();
  try {
    const origin = new URL(project.config.url).origin; const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', acceptDownloads: false });
    context.setDefaultTimeout(5000); context.setDefaultNavigationTimeout(10000); let runtimeErrors = 0; const responseChecks = [];
    const buildPaths = new Set(Object.keys(project.identity.before.files).filter(key => key.startsWith(`build/${project.config.buildDirectory}/`)).map(key => `/${key.slice(`build/${project.config.buildDirectory}/`.length)}`));
    await context.route('**/*', route => allowedRunningRequest(origin, route.request().url(), route.request().method(), buildPaths) ? route.continue() : (runtimeErrors++, route.abort()));
    await context.routeWebSocket('**/*', socket => { runtimeErrors++; socket.close(); });
    context.on('page', page => { page.on('pageerror', () => runtimeErrors++); page.on('console', message => { if (message.type() === 'error') runtimeErrors++; }); page.on('download', () => runtimeErrors++); page.on('response', response => {
      if (response.status() >= 300 || response.request().redirectedFrom()) runtimeErrors++;
      const path = new URL(response.url()).pathname.replace(/^\//, '') || 'index.html'; const key = `build/${project.config.buildDirectory}/${path}`;
      if (Object.hasOwn(project.identity.before.files, key) && response.status() === 200) responseChecks.push(response.body().then(bytes => { if (digest(bytes) !== project.identity.before.files[key]) runtimeErrors++; }).catch(() => runtimeErrors++));
    }); });
    const page = await context.newPage(); await page.goto(project.config.url); await page.waitForLoadState('load');
    const observations = await collectUiObservations(connectedTab(page), project.config.journey);
    const measured = [], repairObservations=[];
    for (const width of [1280, 390]) { await page.setViewportSize({ width, height: 900 }); await page.goto(project.config.url); await page.waitForLoadState('load'); const current=await collectMeasurements(page, project.measurements);measured.push(...current);repairObservations.push(...await observeRepairCandidates(page,project,current)); }
    await Promise.all(responseChecks);
    const after = await snapshotRunningProject(project); if (after.sha256 !== project.identity.before.sha256) throw new Error('Configured source, build, identity, or configuration changed during verification');
    if (runtimeErrors) throw new Error('Incomplete verification: blocked, redirected, failed, downloaded, or non-matching served resources');
    const base = evaluateObservations(project.contract, observations, { artifactSha256: project.identity.before.sha256 }); const checks = [...base.checks, ...evaluateDesignObservations(measured)];
    const candidates=[...new Map(repairObservations.filter(item=>checks.some(check=>check.target===item.target&&check.check===item.check&&check.status==='fail'&&check.viewport?.width===item.viewport)).map(item=>[item.id,item])).values()];
    const repair=candidates.length?{schemaVersion:2,integration:'vite-preview',artifactSha256:base.artifactSha256,specSha256:base.specSha256,configHash:project.configHash,candidates}:null;
    const report = { ...base, status: reportStatus(checks), checks, repair, projectConfigurationSha256: project.configHash, runningApp: { integration: project.config.integration, origin, identity: project.identity.before, sourceMapping: 'Only repairStylesheets with byte-identical source/build assets and browser declaration intervention can authorize the listed CSS repairs. Other paths are labels.', viewports: [1280, 390] }, limitations: [...base.limitations, 'Automatic running-app repairs support only literal font-size and padding-top in explicitly mapped, byte-identical plain ID stylesheets. Other findings require manual changes.', 'A repair changes source only. Rebuild the trusted Vite project and recheck before claiming correction.', 'Only same-origin GET resources are supported. Redirects, external resources, WebSockets, service workers and downloads make evidence incomplete.'] };
    const summary = { status: report.status, artifactSha256: report.artifactSha256, specSha256: report.specSha256, checks: checks.length, findings: checks.filter(check => check.status !== 'pass'), exitCode: report.status === 'pass' ? 0 : report.status === 'fail' ? 1 : 2 };
    return { result: { report, repair, observations, measurements: measured, identity: project.identity.before }, summary, targetPaths: project.config.targetPaths };
  } finally { await browser.close(); }
}
