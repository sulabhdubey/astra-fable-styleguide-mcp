import assert from 'node:assert/strict';
import {renderHtmlReport,compareReports} from './html-report.mjs';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL,fileURLToPath } from 'node:url';
import {chromium} from 'playwright';

const runtimePath = resolve(process.argv[2] ?? 'scripts/running-app.mjs');
const { runRunningCheck } = await import(pathToFileURL(runtimePath).href);
const {previewRunningRepair,applyRunningRepair,undoRunningRepair}=await import(pathToFileURL(join(dirname(runtimePath),'running-repair.mjs')).href);
const {startStudio}=await import(pathToFileURL(join(dirname(runtimePath),'studio.mjs')).href);

const html = extra => `<!doctype html><html><head><style>
body{margin:0;background:#FFFFFF;color:#0F172A;font-family:Inter,ui-sans-serif,system-ui,sans-serif}main{padding:16px}h1{font-size:24px;line-height:1.2;padding-top:16px}button{min-width:40px;min-height:40px}button:focus-visible{outline:3px solid #2563EB}#dialog{display:none}
</style></head><body><main><h1 id="title">Measured interface</h1><button id="open">Review</button><section id="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h2 id="dialog-title">Review</h2><button id="close">Close</button></section>${extra}</main><script>
const open=document.querySelector('#open'),dialog=document.querySelector('#dialog'),close=document.querySelector('#close');
function dismiss(){dialog.style.display='none';open.focus()} open.addEventListener('click',()=>{dialog.style.display='block';close.focus()}); close.addEventListener('click',dismiss); dialog.addEventListener('keydown',event=>{if(event.key==='Tab')event.preventDefault();if(event.key==='Escape')dismiss()});
</script></body></html>`;

async function fixture(extra = '') {
  const root = await mkdtemp(join(tmpdir(), 'style-running-browser-')); await mkdir(join(root, 'src')); await mkdir(join(root, 'dist'));
  const config = { schemaVersion: 2, integration: 'vite-preview', url: 'http://127.0.0.1:4173/', sourceDirectory: 'src', buildDirectory: 'dist', identityFiles: ['package.json'], journey: { buttons: ['#open'], trigger: '#open', dialog: '#dialog', name: 'Review', dialogButtons: ['#close'], close: '#close' }, targetPaths: { '#open': 'src/App.jsx', '#close': 'src/App.jsx', '#title': 'src/App.jsx', dialog: 'src/App.jsx', page: 'src/App.jsx' }, measurements: [{ selector: '#title', target: '#title', typography: { fontFamily: 'typography.fontFamily.sans', fontSize: 'typography.fontSize.500', lineHeight: 'typography.lineHeight.tight' }, spacing: { paddingTop: 'space.4' }, contrast: { foreground: 'semantic.text.primary', background: 'semantic.surface.primary' } }] };
  await Promise.all([writeFile(join(root, 'src', 'App.jsx'), 'export const sourceSentinel = true;\n'), writeFile(join(root, 'dist', 'index.html'), html(extra)), writeFile(join(root, 'package.json'), '{"private":true}\n'), writeFile(join(root, 'project.json'), JSON.stringify(config))]);
  return { root, config: join(root, 'project.json'), source: join(root, 'src', 'App.jsx') };
}
async function serve(root, { substitute } = {}) {
  const bytes = await readFile(join(root, 'dist', 'index.html'));
  const server = createServer(async(request, response) => {
    if (request.url === '/' || request.url === '/index.html') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(substitute ?? bytes); return; }
    if(request.url==='/title.css'){try{const css=await readFile(join(root,'dist/title.css'));response.writeHead(200,{'Content-Type':'text/css'});response.end(css);return;}catch{}}
    response.writeHead(404); response.end('not found');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4173, '127.0.0.1', resolve); });
  return server;
}
async function close(server) { await new Promise(resolve => server.close(resolve)); }

const repository=fileURLToPath(new URL('../',import.meta.url));
const reactRoot = resolve(repository,'examples/running-react');
const vite = resolve(repository,'node_modules/vite/bin/vite.js');
function start(args) { return spawn(process.execPath, [vite, ...args], { cwd: reactRoot, stdio: ['ignore', 'pipe', 'pipe'] }); }
async function ready(url) { for (let attempt = 0; attempt < 40; attempt++) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise(resolveDelay => setTimeout(resolveDelay, 100)); } throw new Error('Vite preview did not start'); }

const sourcePath = resolve(reactRoot, 'src/App.jsx'); const sourceBefore = await readFile(sourcePath);
const stylePath=resolve(reactRoot,'src/public/title.css'),styleBefore=await readFile(stylePath);
const receipts=await mkdtemp(join(tmpdir(),'style-running-receipts-'));
async function rebuild(){const build=start(['build']);await once(build,'exit');assert.equal(build.exitCode,0,'Vite rebuild failed');}
const build = start(['build']); await once(build, 'exit'); assert.equal(build.exitCode, 0, 'Vite fixture build failed');
const preview = start(['preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort']);
try {
  await ready('http://127.0.0.1:4173/');
  const good = await runRunningCheck(resolve(reactRoot, 'project.json')); assert.equal(good.summary.status, 'pass', JSON.stringify(good.result.report.checks)); assert.equal(good.result.repair, null);
  assert.match(renderHtmlReport(good.result,good.targetPaths),/verification report/);assert.equal(compareReports(good.result.report,good.result).compatible,true);
  const broken = await runRunningCheck(resolve(reactRoot, 'project-broken.json')); assert.equal(broken.summary.status, 'fail'); assert.equal(broken.summary.findings.some(check => check.check === 'typography.fontSize' && check.status === 'fail'), true);
  assert.equal(broken.result.repair.candidates.length,1,'a verified declaration should map to source');
  const config=resolve(reactRoot,'project.json');
  await writeFile(stylePath,styleBefore.toString().replace('24px','20px'));
  await assert.rejects(runRunningCheck(config),/rebuild/, 'source changes cannot be checked against a stale copied stylesheet');
  await rebuild();const failed=await runRunningCheck(config);assert.equal(failed.summary.status,'fail');
  const packet=failed.result.repair,change={candidateId:packet.candidates[0].id};
  const reviewed=await previewRunningRepair(config,packet,change);assert.equal(reviewed.diff.before,'20px');assert.equal(reviewed.diff.after,'24px');
  await assert.rejects(applyRunningRepair(config,packet,{candidateId:'0'.repeat(64)},{receiptDirectory:receipts}),/not supported/);
  const applied=await applyRunningRepair(config,packet,change,{receiptDirectory:receipts});assert.equal(applied.requiresRebuild,true);
  assert.deepEqual(await readFile(stylePath),styleBefore);
  await assert.rejects(runRunningCheck(config),/rebuild/);await rebuild();
  assert.equal((await runRunningCheck(config)).summary.status,'pass');
  await assert.rejects(applyRunningRepair(config,packet,change,{receiptDirectory:receipts}),/Stale/);
  await writeFile(sourcePath,Buffer.concat([sourceBefore,Buffer.from('\n// intervening edit\n')]));
  await assert.rejects(undoRunningRepair(config,applied.receiptPath,{receiptDirectory:receipts}),/Stale undo/);
  await writeFile(sourcePath,sourceBefore);
  const undone=await undoRunningRepair(config,applied.receiptPath,{receiptDirectory:receipts});assert.equal(undone.requiresRebuild,true);
  await assert.rejects(runRunningCheck(config),/rebuild/);await rebuild();
  assert.equal((await runRunningCheck(config)).summary.status,'fail');
  const studio=await startStudio({workspace:reactRoot,evidenceDirectory:receipts}),browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    const message=text=>page.getByRole('status').filter({hasText:text}).waitFor({timeout:60000});
    await page.goto(studio.url);await message('local projects found');await page.getByLabel('Project',{exact:true}).selectOption('.');await message('Running application selected');
    await page.getByRole('button',{name:'Run checks',exact:true}).click();await message('Review highlighted findings');
    assert.equal(await page.locator('#before').isDisabled(),true);
    await page.getByRole('button',{name:'Preview correction',exact:true}).click();await message('Review the exact change');
    assert.match(await page.locator('#diff').textContent(),/font-size/);
    if(process.argv[3])await page.screenshot({path:join(resolve(process.argv[3]),'running-repair-preview.png'),fullPage:true});
    await page.getByRole('button',{name:'Apply this correction',exact:true}).click();await message('Source corrected. Rebuild');
    assert.equal(await page.locator('#results').isHidden(),true);await rebuild();
    await page.getByRole('button',{name:'Run checks',exact:true}).click();await message('Configured checks passed');
    await page.getByRole('button',{name:'Undo last correction',exact:true}).click();await message('Original source restored. Rebuild');await rebuild();
    await page.getByRole('button',{name:'Run checks',exact:true}).click();await message('Review highlighted findings');
    assert.equal(await page.locator('#result-status').textContent(),'fail');assert.deepEqual(errors,[]);
  }finally{await browser.close();await studio.close();}
} finally { preview.kill(); await once(preview, 'exit');await writeFile(sourcePath,sourceBefore);await writeFile(stylePath,styleBefore);await rebuild();await rm(receipts,{recursive:true,force:true}); }
assert.deepEqual(await readFile(sourcePath), sourceBefore, 'browser observation must not change React fixture source bytes');

const clean = await fixture();
try {
  const before = await readFile(clean.source); const server = await serve(clean.root);
  try {
    const result = await runRunningCheck(clean.config); assert.equal(result.summary.status, 'pass', JSON.stringify(result.result.report.checks));
    const config=JSON.parse(await readFile(clean.config,'utf8'));config.url=config.url.replace(/\/$/,'');await writeFile(clean.config,JSON.stringify(config));
    const withoutSlash=await runRunningCheck(clean.config);assert.equal(withoutSlash.summary.status,'pass');assert.equal(withoutSlash.result.report.runningApp.origin,'http://127.0.0.1:4173');
  }
  finally { await close(server); }
  assert.deepEqual(await readFile(clean.source), before, 'browser observation must not change source bytes');
} finally { await rm(clean.root, { recursive: true, force: true }); }

const composited = await fixture('<style>main{opacity:.5}</style>');
try {
  const server = await serve(composited.root);
  try {
    const result = await runRunningCheck(composited.config);
    assert.equal(result.result.report.checks.find(check => check.check === 'contrast').status, 'unsupported');
  } finally { await close(server); }
} finally { await rm(composited.root, { recursive: true, force: true }); }

const duplicate = await fixture('<h1 id="title">Ambiguous target</h1>');
try {
  const server = await serve(duplicate.root);
  try { await assert.rejects(runRunningCheck(duplicate.config), /match exactly one element/); }
  finally { await close(server); }
} finally { await rm(duplicate.root, { recursive: true, force: true }); }

const untracked = await fixture('<img alt="probe" src="/untracked.png">');
try {
  const server = await serve(untracked.root);
  try { await assert.rejects(runRunningCheck(untracked.config), /Incomplete verification/); }
  finally { await close(server); }
} finally { await rm(untracked.root, { recursive: true, force: true }); }

const mismatched = await fixture();
try {
  const bytes = await readFile(join(mismatched.root, 'dist', 'index.html')); const server = await serve(mismatched.root, { substitute: Buffer.concat([bytes, Buffer.from('<!-- altered -->')]) });
  try { await assert.rejects(runRunningCheck(mismatched.config), /Incomplete verification/); }
  finally { await close(server); }
} finally { await rm(mismatched.root, { recursive: true, force: true }); }

for(const [label,extra]of [['overridden','<style>#title{font-size:20px!important}</style>'],['runtime-mutated','<script>addEventListener("load",()=>{document.querySelector("link").sheet.cssRules[0].style.setProperty("font-size","21px")})</script>']]) {
  const project=await fixture(extra);
  try {
    const config=JSON.parse(await readFile(project.config,'utf8'));config.repairStylesheets=[{source:'src/title.css',build:'title.css'}];
    const css='#title{font-size:20px;}';
    await writeFile(project.config,JSON.stringify(config));await writeFile(join(project.root,'src/title.css'),css);await writeFile(join(project.root,'dist/title.css'),css);
    const index=join(project.root,'dist/index.html');await writeFile(index,(await readFile(index,'utf8')).replace('</head>','<link rel="stylesheet" href="/title.css"></head>'));
    const server=await serve(project.root);try{const checked=await runRunningCheck(project.config);assert.equal(checked.summary.status,'fail',label);assert.equal(checked.result.repair,null,`${label} cannot authorize source repair`);}finally{await close(server);}
  }finally{await rm(project.root,{recursive:true,force:true});}
}

console.log('Real React/Vite: detected source defect, verified CSS mapping, preview/apply, stale-build refusal, rebuild/pass, stale packet and intervening edit refusal, undo/rebuild/fail. Complete Studio UI correction/rebuild/recheck/undo flow passed. Fixture restored. Browser boundaries: exact build, compositing unsupported, duplicate selectors rejected, untracked/mismatched resources refused.');
