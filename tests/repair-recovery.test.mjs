import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,unlink,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {loadProject,snapshotProject,previewRepair,applyRepair,undoRepair} from '../scripts/project-workflow.mjs';
const config={schemaVersion:1,files:['index.html'],journey:{buttons:['#open'],trigger:'#open',dialog:'#dialog',name:'Review',dialogButtons:['#close'],close:'#close'},targetPaths:{'#open':'index.html','#close':'index.html',dialog:'index.html',page:'index.html'}};
async function fixture(run){
  const root=await mkdtemp(join(tmpdir(),'repair-root-')),receiptDirectory=await mkdtemp(join(tmpdir(),'repair-journal-'));
  try {
    await writeFile(join(root,'project.json'),JSON.stringify(config));await writeFile(join(root,'index.html'),'\ufefffirst\r\nOLD\r\nlast');
    const project=await loadProject(join(root,'project.json')),snap=await snapshotProject(project);
    const packet={artifactSha256:snap.artifactSha256,specSha256:snap.contract.specSha256,findings:[{path:'index.html',status:'fail'}]};
    await run({root,project,packet,options:{receiptDirectory},change:{path:'index.html',before:'OLD',after:'NEW'}});
  } finally {for(const dir of [root,receiptDirectory]){for(const name of await readdir(dir))await unlink(join(dir,name));await rmdir(dir);}}
}
test('preview is read only; durable receipt and undo preserve BOM and CRLF exactly',()=>fixture(async({root,project,packet,options,change})=>{
  const original=await readFile(join(root,'index.html'));
  const preview=await previewRepair(project,packet,change);
  assert.deepEqual(preview.diff,{path:'index.html',before:'OLD',after:'NEW'});
  assert.deepEqual(await readFile(join(root,'index.html')),original);
  const result=await applyRepair(project,packet,change,options);
  const journal=JSON.parse(await readFile(result.receiptPath,'utf8'));
  assert.equal(journal.phase,'prepared');assert.equal(journal.original,original.toString('utf8'));
  assert.equal(result.artifactSha256,preview.artifactSha256);
  const misplaced=join(root,'misplaced.json');await writeFile(misplaced,JSON.stringify(journal));
  await assert.rejects(undoRepair(project,misplaced,options),/outside the private/);
  await undoRepair(project,result.receiptPath,options);
  assert.deepEqual(await readFile(join(root,'index.html')),original);
  await assert.rejects(undoRepair(project,result.receiptPath,options),/Stale/);
}));
test('private receipts are mandatory and current source wins over undo',()=>fixture(async({root,project,packet,options,change})=>{
  await assert.rejects(applyRepair(project,packet,change),/private receipt/);
  await assert.rejects(applyRepair(project,packet,change,{receiptDirectory:root}),/outside/);
  const result=await applyRepair(project,packet,change,options);
  await writeFile(join(root,'index.html'),'editor change');
  await assert.rejects(undoRepair(project,result.receiptPath,options),/Stale/);
  assert.equal(await readFile(join(root,'index.html'),'utf8'),'editor change');
}));
test('interrupted staged transaction leaves a lock that cannot be silently stolen',()=>fixture(async({root,project,packet,options,change})=>{
  const preview=await previewRepair(project,packet,change);
  const receipt=join(options.receiptDirectory,'interrupted.json');
  const child=spawnSync(process.execPath,['--input-type=module','-e',`import{writeFileSync}from'node:fs';const [root,receipt,preview]=process.argv.slice(1);writeFileSync(root+'/.style-repair.lock','interrupted',{flag:'wx'});writeFileSync(receipt,preview,{flag:'wx'});writeFileSync(root+'/index.html.interrupted.tmp','staged',{flag:'wx'});process.exit(17);`,root,receipt,JSON.stringify({...preview,phase:'prepared'})]);
  assert.equal(child.status,17);
  await assert.rejects(applyRepair(project,packet,change,options),/EEXIST/);
  assert.equal((await snapshotProject(project)).artifactSha256,packet.artifactSha256);
  // Explicit recovery of this test-owned dead process; the product never steals it.
  await unlink(join(root,'.style-repair.lock'));await unlink(join(root,'index.html.interrupted.tmp'));
  await assert.rejects(undoRepair(project,receipt,options),/Stale/);
  await applyRepair(project,packet,change,options);
}));
test('concurrent cooperating repairs serialize and reject the stale loser',()=>fixture(async({project,packet,options,change})=>{
  const results=await Promise.allSettled([applyRepair(project,packet,change,options),applyRepair(project,packet,change,options)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.message,/EEXIST|Stale/);
}));
test('invalid UTF-8 is rejected instead of rewriting replacement characters',()=>fixture(async({root,project})=>{
  await writeFile(join(root,'index.html'),Buffer.from([0xff,0xfe,0x80]));
  await assert.rejects(snapshotProject(project),/encoded data/);
}));
