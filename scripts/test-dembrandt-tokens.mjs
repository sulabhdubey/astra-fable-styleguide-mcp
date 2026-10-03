/* global structuredClone */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const modulePath = resolve(process.argv[2] ?? 'scripts/dembrandt-browser.mjs');
const repository = fileURLToPath(new URL('../', import.meta.url));
const integration = await import(pathToFileURL(modulePath).href).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('dembrandt-browser.mjs')) return null;
  throw error;
});
assert.ok(integration?.runDembrandtCheck, 'Real browser token verification must be implemented');
const root = await mkdtemp(join(tmpdir(), 'stylecon-dembrandt-browser-'));
const exportPath = join(root, 'export.json'), pagePath = join(root, 'page.html');
const expected = '#2563eb';
const base = { meta: { schemaVersion: '1.17.0', snapshotId: 'browser-fixture', httpStatus: 200, viewport: { width: 900, height: 600 }, fontsReady: true, errors: [], degraded: [] }, colors: { palette: [{ color: expected, normalized: expected, tokens: ['--accent'], count: 1, confidence: 'high' }] } };
const page = (css = ':root{--accent:rgb(37 99 235)}', content = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css}</style></head><body><h1>Declared color fixture</h1>${content}</body></html>`;
const results = [];
async function check(name, expectedStatus, html = page(), exported = base, options = {}) {
  await writeFile(exportPath, JSON.stringify(exported)); await writeFile(pagePath, html);
  const before = [await readFile(exportPath), await readFile(pagePath)].map(bytes => createHash('sha256').update(bytes).digest('hex'));
  const report = await integration.runDembrandtCheck(exportPath, pagePath, options);
  assert.equal(report.status, expectedStatus, `${name}: ${JSON.stringify(report)}`);
  assert.equal(report.evidence.exportSha256, before[0]); assert.equal(report.evidence.pageSha256, before[1]);
  const after = [await readFile(exportPath), await readFile(pagePath)].map(bytes => createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(after, before, 'Verification must not change inputs');
  results.push({ name, status: report.status, issues: report.issues });
  return report;
}
try {
  await check('equivalent RGB notation', 'match');
  await check('equivalent legacy RGB notation', 'match', page(':root{--accent:rgb(37,99,235)}'));
  await check('changed declared token', 'mismatch', page(':root{--accent:#ff0000}'));
  await check('missing declared token', 'incomplete', page(''));
  await check('body overrides root', 'mismatch', page(':root{--accent:#2563eb}body{--accent:#ff0000}'));
  await check('explicit root scope', 'match', page(':root{--accent:#2563eb}body{--accent:#ff0000}'), base, { scope: 'root' });
  await check('matching responsive viewport', 'match', page(':root{--accent:#ff0000}@media(min-width:800px){:root{--accent:#2563eb}}'));
  const dark = structuredClone(base); dark.meta.flags = { darkMode: true };
  await check('matching dark color scheme', 'match', page(':root{--accent:#ff0000}@media(prefers-color-scheme:dark){:root{--accent:#2563eb}}'), dark);
  await check('modern sRGB notation', 'match', page(':root{--accent:color(srgb 0.1450980392 0.3882352941 0.9215686275)}'));
  await check('color mix resolves', 'match', page(':root{--accent:color-mix(in srgb,#2563eb 100%,white)}'));
  await check('alpha stays incomplete', 'incomplete', page(':root{--accent:rgb(37 99 235 / .5)}'));
  await check('near opaque alpha stays incomplete', 'incomplete', page(':root{--accent:rgb(37 99 235 / .9999)}'));
  await check('legacy RGB alpha stays incomplete', 'incomplete', page(':root{--accent:rgb(37,99,235,.9999)}'));
  await check('computed alpha expression stays incomplete', 'incomplete', page(':root{--accent:rgba(37,99,235,calc(.9999))}'));
  await check('nested mixed alpha stays incomplete', 'incomplete', page(':root{--accent:color-mix(in srgb,rgba(37,99,235,1) 50%,rgba(37,99,235,.9999))}'));
  await check('mixed transparent color stays incomplete', 'incomplete', page(':root{--accent:color-mix(in srgb,#2563eb 99.9999%,transparent .0001%)}'));
  await check('mixed alpha hex stays incomplete', 'incomplete', page(':root{--accent:color-mix(in srgb,#2563ebfe .0001%,#2563eb 99.9999%)}'));
  await check('unsupported contextual color stays incomplete', 'incomplete', page(':root{--accent:light-dark(#2563eb,#2563eb)}'));
  await check('contextual currentColor stays incomplete', 'incomplete', page(':root{color:#2563eb;--accent:currentColor}'));
  const observationOnly = structuredClone(base); delete observationOnly.colors.palette[0].tokens;
  await check('no tokens observed only', 'unverified', page(), observationOnly);
  const degraded = structuredClone(base); degraded.meta.degraded = ['colors'];
  await check('failed extraction', 'incomplete', page(), degraded);
  await check('external resource blocked', 'incomplete', page(undefined, '<img alt="external" src="https://example.invalid/probe.png">'));
  await check('page error', 'incomplete', page(undefined, '<script>throw new Error("fixture error")</script>'));
  const unknown = structuredClone(base); unknown.meta.schemaVersion = '2.0.0';
  await check('unsupported version skips browser', 'incomplete', page(), unknown);
  const nativeExport = JSON.parse(await readFile(resolve(repository, 'examples/dembrandt/export.json'), 'utf8'));
  const nativePage = await readFile(resolve(repository, 'examples/dembrandt/page.html'), 'utf8');
  const native = await check('native Dembrandt 0.38.0 export', 'match', nativePage, nativeExport);
  assert.equal(native.checks.length, 3);
  await check('native export changed page', 'mismatch', nativePage.replace('--accent: #2563eb', '--accent: #ef4444'), nativeExport);
  await check('native export missing token', 'incomplete', nativePage.replace('--accent: #2563eb;', ''), nativeExport);
  await assert.rejects(integration.runDembrandtCheck(exportPath, pagePath, { scope: '#arbitrary' }), /scope/i);
  await writeFile(exportPath, JSON.stringify(base)); await writeFile(pagePath, page());
  const cli = process.argv[3] ? resolve(process.argv[3]) : resolve('packages/cli/dist/stylecon.mjs');
  const invoke = args => spawnSync(process.execPath, [cli, 'tokens', 'check', exportPath, pagePath, ...args], { encoding: 'utf8', timeout: 30000 });
  const json = invoke(['--format', 'json']); assert.equal(json.status, 0, json.stderr); assert.equal(JSON.parse(json.stdout).status, 'match');
  const unsafeOutput = invoke(['--output', join(root, 'report.json')]); assert.equal(unsafeOutput.status, 2); assert.match(unsafeOutput.stderr, /outside/);
  const unknownOption = invoke(['--remote']); assert.equal(unknownOption.status, 2); assert.match(unknownOption.stderr, /option/i);
  const output = join(dirname(root), `stylecon-token-report-${root.split(/[\\/]/).pop()}.html`);
  try {
    const html = invoke(['--format', 'html', '--output', output]); assert.equal(html.status, 0, html.stderr);
    assert.match(await readFile(output, 'utf8'), /Declared color token comparison/);
    const exists = invoke(['--format', 'html', '--output', output]); assert.equal(exists.status, 2); assert.match(exists.stderr, /exist/i);
  } finally { await rm(output, { force: true }); }
  console.log(JSON.stringify({ browser: 'Chromium', cases: results, cli: 'JSON, HTML, exclusive output, containment and option checks passed', inputMutation: false }, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
