import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, unlink, rmdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { get } from 'node:http';
import { loadProject, snapshotProject, applyRepair as applyRawRepair, startProjectServer } from '../scripts/project-workflow.mjs';

let receiptDirectory;
const applyRepair=(...args)=>applyRawRepair(...args,{receiptDirectory});
async function cleanReceipts(){for(const name of await readdir(receiptDirectory))await unlink(join(receiptDirectory,name));await rmdir(receiptDirectory);}
const config = { schemaVersion:1, files:['index.html'], journey:{buttons:['#open'],trigger:'#open',dialog:'#dialog',name:'Review',dialogButtons:['#close'],close:'#close'}, targetPaths:{'#open':'index.html','#close':'index.html',dialog:'index.html',page:'index.html'} };
test('project repair is allowlisted, exact-snapshot-bound and invalidates prior evidence', async () => {
  const root=await mkdtemp(join(tmpdir(),'style-project-'));
  receiptDirectory=await mkdtemp(join(tmpdir(),'style-receipts-'));
  try {
    await writeFile(join(root,'project.json'),JSON.stringify(config)); await writeFile(join(root,'index.html'),'<button>broken</button>');
    const project=await loadProject(join(root,'project.json')); const before=await snapshotProject(project);
    const server=await startProjectServer(project);const origin=`http://127.0.0.1:${server.address().port}`;
    try {
      assert.equal((await fetch(origin)).status,200);
      assert.equal((await fetch(`${origin}/project.json`)).status,404);
      assert.equal((await fetch(origin,{headers:{origin:'https://untrusted.invalid'}})).status,403);
      const hostileHost=await new Promise((resolve,reject)=>get(origin,{headers:{host:'untrusted.invalid'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));
      assert.equal(hostileHost,403);
      assert.equal((await fetch(origin,{method:'POST'})).status,405);
      const metadata=await(await fetch(`${origin}/_verification`)).json();assert.equal(metadata.artifactSha256,before.artifactSha256);
      assert.ok(!JSON.stringify(metadata).includes(root));
    } finally {await new Promise(resolve=>server.close(resolve));}
    const repair={artifactSha256:before.artifactSha256,specSha256:before.contract.specSha256,findings:[{path:'index.html',status:'fail'}]};
    const lock=join(root,'.style-repair.lock');await writeFile(lock,'owned');
    try {await assert.rejects(applyRepair(project,repair,{path:'index.html',before:'broken',after:'fixed'}),/EEXIST/);}
    finally {await unlink(lock);}
    await assert.rejects(applyRepair(project,repair,{path:'../escape.html',before:'broken',after:'fixed'}),/allowed/);
    await assert.rejects(applyRepair(project,repair,{path:'index.html',before:'absent',after:'fixed'}),/exactly once/);
    const result=await applyRepair(project,repair,{path:'index.html',before:'broken',after:'fixed'});
    assert.notEqual(result.artifactSha256,before.artifactSha256);
    assert.equal(await readFile(join(root,'index.html'),'utf8'),'<button>fixed</button>');
    await assert.rejects(applyRepair(project,repair,{path:'index.html',before:'fixed',after:'again'}),/Stale/);
    await writeFile(join(root,'project.json'),JSON.stringify({...config,privateNote:'must not be served'}));
    await assert.rejects(loadProject(join(root,'project.json')),/Unknown project/);
    await writeFile(join(root,'project.json'),JSON.stringify({...config,files:['index.html','../secret.html']}));
    await assert.rejects(loadProject(join(root,'project.json')),/Unsafe/);
  } finally { await unlink(join(root,'index.html')); await unlink(join(root,'project.json')); await rmdir(root);await cleanReceipts(); }
});

test('repair inserts replacement metacharacters literally', async () => {
  const root=await mkdtemp(join(tmpdir(),'style-literal-'));
  receiptDirectory=await mkdtemp(join(tmpdir(),'style-receipts-'));
  try {
    await writeFile(join(root,'project.json'),JSON.stringify(config));
    await writeFile(join(root,'index.html'),'prefix OLD suffix');
    const project=await loadProject(join(root,'project.json')); const snapshot=await snapshotProject(project);
    const packet={artifactSha256:snapshot.artifactSha256,specSha256:snapshot.contract.specSha256,findings:[{path:'index.html',status:'fail'}]};
    const literal='$& $$ $` '+"$'";
    await applyRepair(project,packet,{path:'index.html',before:'OLD',after:literal});
    assert.equal(await readFile(join(root,'index.html'),'utf8'),'prefix '+literal+' suffix');
  } finally {await unlink(join(root,'index.html'));await unlink(join(root,'project.json'));await rmdir(root);await cleanReceipts();}
});
