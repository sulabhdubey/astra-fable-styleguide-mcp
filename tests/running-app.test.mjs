import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedRunningRequest, loadRunningProject, runRunningCheck } from '../scripts/running-app.mjs';
import { evaluateDesignObservations } from '../scripts/design-observations.mjs';
import { pinConstitution } from '../scripts/constitution.mjs';

async function fixture(config = {}) {
  const root = await mkdtemp(join(tmpdir(), 'style-running-app-'));
  await mkdir(join(root, 'src')); await mkdir(join(root, 'dist'));
  await Promise.all([
    writeFile(join(root, 'src', 'App.jsx'), 'export default function App(){}\n'),
    writeFile(join(root, 'dist', 'index.html'), '<!doctype html><main id="app"></main>\n'),
    writeFile(join(root, 'package.json'), '{"name":"fixture","private":true}\n'),
    writeFile(join(root, 'vite.config.mjs'), 'export default {}\n')
  ]);
  const value = {
    schemaVersion: 2,
    integration: 'vite-preview',
    url: 'http://127.0.0.1:4173/',
    sourceDirectory: 'src',
    buildDirectory: 'dist',
    identityFiles: ['package.json', 'vite.config.mjs'],
    journey: { buttons: ['#open'], trigger: '#open', dialog: '#dialog', name: 'Review', dialogButtons: ['#close'], close: '#close' },
    targetPaths: { '#open': 'src/App.jsx', '#close': 'src/App.jsx', '#title': 'src/App.jsx', dialog: 'src/App.jsx', page: 'src/App.jsx' },
    measurements: [{ selector: '#title', target: '#title', typography: { fontFamily: 'typography.fontFamily.sans', fontSize: 'typography.fontSize.500', lineHeight: 'typography.lineHeight.tight' }, spacing: { paddingTop: 'space.4' }, contrast: { foreground: 'semantic.text.primary', background: 'semantic.surface.primary' } }],
    ...config
  };
  const path = join(root, 'project.json'); await writeFile(path, JSON.stringify(value));
  return { root, path };
}

test('schema v2 binds local source, build, identity files and canonical measurement tokens', async () => {
  const project = await fixture();
  try {
    const loaded = await loadRunningProject(project.path);
    assert.equal(loaded.config.integration, 'vite-preview');
    assert.equal(loaded.config.url, 'http://127.0.0.1:4173/');
    assert.deepEqual(Object.keys(loaded.identity.before.files).sort(), ['build/dist/index.html', 'identity/package.json', 'identity/vite.config.mjs', 'source/src/App.jsx']);
    assert.equal(loaded.measurements[0].expected.typography.fontSize, '24px');
    assert.equal(loaded.measurements[0].expected.spacing.paddingTop, '16px');
  } finally { await rm(project.root, { recursive: true, force: true }); }
});

test('default running constitution hash covers the same complete canonical snapshot as a pin', async () => {
  const project = await fixture();
  try {
    const repository = fileURLToPath(new URL('../', import.meta.url));
    const pin = await pinConstitution(repository, join(project.root, 'constitution.json'));
    const loaded = await loadRunningProject(project.path);
    assert.equal(loaded.contract.specSha256, pin.sha256);
    assert.equal(loaded.contract.constitution.sha256, pin.sha256);
    assert.match(loaded.contract.specHashScope, /complete bundled canonical snapshot/);
  } finally { await rm(project.root, { recursive: true, force: true }); }
});

test('schema v2 rejects external origins, unsafe mapped paths and invented measurements', async () => {
  for (const config of [
    { url: 'http://localhost:4173/' },
    { url: 'https://127.0.0.1:4173/' },
    { buildDirectory: 'SRC/dist' },
    { buildDirectory: 'SRC' },
    { identityFiles: ['package.json','src/App.jsx'] },
    { identityFiles: ['package.json','SRC/App.jsx'] },
    { identityFiles: ['package.json','PACKAGE.json'] },
    { targetPaths: { '#open': '../App.jsx', '#close': 'src/App.jsx', '#title': 'src/App.jsx', dialog: 'src/App.jsx', page: 'src/App.jsx' } },
    { measurements: [{ selector: '#title', target: '#title', typography: { fontSize: 'made.up.token' } }] }
  ]) {
    const project = await fixture(config);
    try { await assert.rejects(loadRunningProject(project.path), /loopback|Unsafe|canonical token|overlap|Identity files/i); }
    finally { await rm(project.root, { recursive: true, force: true }); }
  }
});

test('repair mapping rejects path aliases before they can create an un-restorable snapshot',async()=>{
  const project=await fixture();
  try{
    await writeFile(join(project.root,'src/title.css'),'#title{font-size:20px;}');await writeFile(join(project.root,'dist/title.css'),'#title{font-size:20px;}');
    for(const mapping of [{source:'src/Title.css',build:'title.css'},{source:'src/title.css',build:'Title.css'}]){
      const config=JSON.parse(await readFile(project.path,'utf8'));config.repairStylesheets=[mapping];
      await writeFile(project.path,JSON.stringify(config));await assert.rejects(loadRunningProject(project.path),/exact snapshot path casing/);
    }
  }finally{await rm(project.root,{recursive:true,force:true});}
});

test('running check never converts an unavailable browser into a synthetic pass', async () => {
  const project = await fixture();
  try { await assert.rejects(runRunningCheck(project.path, { launch: async () => { throw new Error('browser unavailable'); } }), /browser unavailable/); }
  finally { await rm(project.root, { recursive: true, force: true }); }
});

test('design observations report configured token mismatches and opaque contrast limitations', () => {
  const measurements = [{
    selector: '#title', target: '#title',
    expected: { typography: { fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: '24px', lineHeight: 1.2 }, spacing: { paddingTop: '16px' }, contrast: { foreground: '#0F172A', background: '#FFFFFF', minimum: 4.5 } },
    found: true, observed: { fontFamily: 'Arial', fontSize: '20px', lineHeight: '24px', paddingTop: '8px', color: 'rgb(15, 23, 42)', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', opacity: '1' }, viewport: { width: 390, scrollWidth: 420 }
  }];
  const checks = evaluateDesignObservations(measurements);
  assert.equal(checks.find(check => check.check === 'typography.fontSize').status, 'fail');
  assert.equal(checks.find(check => check.check === 'spacing.paddingTop').status, 'fail');
  assert.equal(checks.find(check => check.check === 'contrast').status, 'unsupported');
  assert.equal(checks.find(check => check.check === 'overflow').status, 'fail');
});

test('design observations normalize supported relative dimensions and expose unsupported units or compositing', () => {
  const relative = evaluateDesignObservations([{ selector: '#title', target: '#title', found: true,
    expected: { typography: { fontSize: '1.5rem' }, spacing: { paddingTop: '1em' }, contrast: { foreground: '#0F172A', background: '#FFFFFF', minimum: 4.5 } },
    observed: { fontSize: '24px', parentFontSize: '16px', rootFontSize: '16px', paddingTop: '24px', color: 'rgb(15, 23, 42)', backgroundColor: 'rgb(255, 255, 255)', backgroundImage: 'none', composited: true }, viewport: { width: 390, scrollWidth: 390 } }]);
  assert.equal(relative.find(check => check.check === 'typography.fontSize').status, 'pass');
  assert.equal(relative.find(check => check.check === 'spacing.paddingTop').status, 'pass');
  assert.equal(relative.find(check => check.check === 'contrast').status, 'unsupported');
  const unsupported = evaluateDesignObservations([{ selector: '#title', target: '#title', found: true,
    expected: { typography: { fontSize: '50%' }, spacing: { paddingTop: 'calc(1rem + 1px)' } }, observed: { fontSize: '24px', paddingTop: '17px', rootFontSize: '16px', parentFontSize: '16px' }, viewport: { width: 390, scrollWidth: 390 } }]);
  assert.equal(unsupported.find(check => check.check === 'typography.fontSize').status, 'unsupported');
  assert.equal(unsupported.find(check => check.check === 'spacing.paddingTop').status, 'unsupported');
});

test('hidden configured design targets remain not checked', () => {
  const checks = evaluateDesignObservations([{ selector: '#hidden', target: '#hidden', found: false,
    expected: { typography: { fontSize: '24px' }, spacing: { paddingTop: '16px' } }, observed: { fontSize: '24px', paddingTop: '16px' }, viewport: { width: 390, scrollWidth: 390 } }]);
  assert.equal(checks.find(check => check.check === 'typography.fontSize').status, 'not_checked');
  assert.equal(checks.find(check => check.check === 'spacing.paddingTop').status, 'not_checked');
  assert.equal(checks.find(check => check.check === 'overflow').status, 'not_checked');
});

test('running preview requests admit only exact configured build assets', () => {
  const origin = 'http://127.0.0.1:4173'; const assets = new Set(['/index.html', '/assets/app.js']);
  assert.equal(allowedRunningRequest(origin, `${origin}/`, 'GET', assets), true);
  assert.equal(allowedRunningRequest(origin, `${origin}/assets/app.js`, 'GET', assets), true);
  for (const url of [`${origin}/api/session`, `${origin}/untracked.json`, 'https://example.invalid/app.js']) assert.equal(allowedRunningRequest(origin, url, 'GET', assets), false);
});

test('running preview routing preserves the port with or without a trailing slash',async()=>{
  for(const url of ['http://127.0.0.1:4173','http://127.0.0.1:4173/']){
    const project=await fixture({url});let admitted=false,closed=false;
    const context={setDefaultTimeout(){},setDefaultNavigationTimeout(){},async route(_pattern,handler){await handler({request:()=>({url:()=>url,method:()=>'GET'}),continue:()=>{admitted=true;},abort(){}});},async routeWebSocket(){},on(){},async newPage(){throw new Error('routing probe complete');}};
    try{
      await assert.rejects(runRunningCheck(project.path,{launch:async()=>({newContext:async()=>context,close:async()=>{closed=true;}})}),/routing probe complete/);
      assert.equal(admitted,true,`Accepted preview origin must remain reachable: ${url}`);assert.equal(closed,true);
    }finally{await rm(project.root,{recursive:true,force:true});}
  }
});
