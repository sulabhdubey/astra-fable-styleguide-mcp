import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile,readdir,unlink,symlink,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {openStudioHistory} from '../scripts/studio-history.mjs';

const hash='a'.repeat(64);
const check=(target,status)=>({ruleId:'STYLE-A11Y-009',check:'target',target,status,observed:{height:status==='pass'?40:24},expected:{minimum:40},fix:'Review minimum height'});
function checked(checks=[check('#one','fail')],overrides={}) {
  const report={status:checks.some(c=>c.status==='fail')?'fail':checks.every(c=>c.status==='pass')?'pass':'not_checked',artifactSha256:hash,specSha256:hash,projectConfigurationSha256:hash,checks,...overrides};
  return {result:{report},summary:{status:report.status,exitCode:report.status==='pass'?0:report.status==='fail'?1:2},targetPaths:Object.fromEntries(checks.map(c=>[c.target,'index.html']))};
}
async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'style-studio-history-'));
  const workspace=join(root,'workspace'),evidenceDirectory=join(root,'evidence');
  await mkdir(workspace);await mkdir(evidenceDirectory);await mkdir(join(workspace,'app'));await mkdir(join(workspace,'other'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  return {root,workspace,evidenceDirectory,history:await openStudioHistory({workspace,evidenceDirectory})};
}
async function storedFiles(root) {
  const result=[];
  for(const entry of await readdir(root,{withFileTypes:true})) {
    const path=join(root,entry.name);
    if(entry.isDirectory()&&!entry.isSymbolicLink())result.push(...await storedFiles(path));else result.push(path);
  }
  return result;
}

test('history survives restart with compact metadata and a report without write authority',async t=>{
  const f=await fixture(t),value=checked();
  value.result.repair={original:'PRIVATE SOURCE BODY',replacement:'PRIVATE REPLACEMENT'};
  value.result.report.repair=value.result.repair;value.result.observations={html:'PRIVATE HTML'};
  value.receipt='PRIVATE RECEIPT';value.summary.original='PRIVATE SUMMARY SOURCE';
  const saved=await f.history.save({project:'app',checked:value});
  assert.match(saved.id,/^[a-f0-9]{32}$/);assert.equal(saved.available,true);assert.equal(saved.status,'fail');assert.equal(saved.counts.fail,1);
  const reopened=await openStudioHistory(f),listed=await reopened.list({project:'app'});
  assert.equal(listed.entries.length,1);assert.deepEqual(listed.entries[0],saved);
  const historical=await reopened.read({project:'app',id:saved.id});
  assert.equal(historical.historyOnly,true);assert.deepEqual(Object.keys(historical.checked.result),['report']);
  assert.equal(historical.checked.summary.status,'fail');assert.equal(historical.checked.targetPaths['#one'],'index.html');
  assert.equal(historical.checked.result.report.repair,undefined);assert.equal(historical.checked.receipt,undefined);
  for(const path of await storedFiles(f.evidenceDirectory))assert.doesNotMatch(await readFile(path,'utf8'),/PRIVATE|"repair"|"receipt"|"observations"/);
});

test('workspace and project namespaces cannot read or transplant another history entry',async t=>{
  const f=await fixture(t),otherWorkspace=join(f.root,'workspace-two');await mkdir(otherWorkspace);await mkdir(join(otherWorkspace,'app'));
  const first=await f.history.save({project:'app',checked:checked()});
  const other=await openStudioHistory({workspace:otherWorkspace,evidenceDirectory:f.evidenceDirectory});
  assert.equal((await other.list({project:'app'})).entries.length,0);
  await assert.rejects(other.read({project:'app',id:first.id}),/unavailable|missing/i);
  await assert.rejects(f.history.read({project:'other',id:first.id}),/unavailable|missing/i);
  const second=await other.save({project:'app',checked:checked()});
  const files=await storedFiles(f.evidenceDirectory),target=dirname(files.find(path=>path.endsWith(second.id+'.entry.json')));
  for(const path of files.filter(path=>path.includes(first.id)))await copyFile(path,join(target,path.endsWith('.entry.json')?first.id+'.entry.json':first.id+'.report.json'));
  await assert.rejects(other.read({project:'app',id:first.id}),/identity|binding|unavailable/i);
  assert.equal((await other.list({project:'app'})).entries.find(entry=>entry.id===first.id).available,false);
});

test('tampered and missing report files remain visibly unavailable after restart',async t=>{
  const f=await fixture(t),tampered=await f.history.save({project:'app',checked:checked()}),missing=await f.history.save({project:'app',checked:checked()});
  const files=await storedFiles(f.evidenceDirectory);
  const tamperedPath=files.find(path=>path.endsWith(tampered.id+'.report.json'));
  await writeFile(tamperedPath,(await readFile(tamperedPath,'utf8')).replace('Review minimum height','Altered guidance'));
  await unlink(files.find(path=>path.endsWith(missing.id+'.report.json')));
  const reopened=await openStudioHistory(f),list=await reopened.list({project:'app'});
  assert.equal(list.entries.length,2);assert.equal(list.unavailableCount,2);
  for(const entry of list.entries){assert.equal(entry.available,false);assert.equal(entry.status,'unavailable');assert.equal(entry.counts,undefined);}
  await assert.rejects(reopened.read({project:'app',id:tampered.id}),/integrity|unavailable/i);
  await assert.rejects(reopened.read({project:'app',id:missing.id}),/missing|unavailable/i);
  await assert.rejects(reopened.compare({project:'app',baseId:tampered.id,headId:missing.id}),/integrity|unavailable/i);
});

test('missing, modified or malformed metadata remains unavailable without failing the history list',async t=>{
  const f=await fixture(t),a=await f.history.save({project:'app',checked:checked()}),b=await f.history.save({project:'app',checked:checked()}),c=await f.history.save({project:'app',checked:checked()});
  const files=await storedFiles(f.evidenceDirectory);
  await unlink(files.find(path=>path.endsWith(a.id+'.entry.json')));
  const meta=files.find(path=>path.endsWith(b.id+'.entry.json'));await writeFile(meta,(await readFile(meta,'utf8')).replace('"status":"fail"','"status":"pass"'));
  await writeFile(files.find(path=>path.endsWith(c.id+'.entry.json')),'{"payload":');
  const list=await f.history.list({project:'app'});
  assert.equal(list.entries.length,3);assert.equal(list.unavailableCount,3);
  for(const entry of list.entries){assert.equal(entry.available,false);assert.equal(entry.status,'unavailable');assert.equal(entry.counts,undefined);}
  await assert.rejects(f.history.read({project:'app',id:c.id}),/unavailable/i);
});

test('comparison distinguishes new, existing, resolved and incomplete checks',async t=>{
  const f=await fixture(t),base=await f.history.save({project:'app',checked:checked([check('#resolved','fail'),check('#new','pass'),check('#existing','fail'),check('#incomplete','pass'),check('#unresolved','fail')])});
  const head=await f.history.save({project:'app',checked:checked([check('#resolved','pass'),check('#new','fail'),check('#existing','fail'),check('#incomplete','not_checked'),check('#unresolved','unsupported')],{artifactSha256:'b'.repeat(64)})});
  const comparison=await f.history.compare({project:'app',baseId:base.id,headId:head.id});
  assert.equal(comparison.compatible,true);assert.equal(comparison.sourceChanged,true);assert.equal(comparison.exitCode,2);
  assert.equal(comparison.newViolations.length,1);assert.equal(comparison.existingViolations.length,1);assert.equal(comparison.resolved.length,1);assert.equal(comparison.incomplete.length,2);
  assert.equal(comparison.unresolvedViolations.length,1);assert.equal(comparison.counts.incomplete,2);
  assert.equal(comparison.resolved[0].target,'#resolved');assert.equal(comparison.unresolvedViolations[0].target,'#unresolved');
});

test('changed rules, configuration, check membership and viewport scope reject comparison',async t=>{
  const f=await fixture(t),base=await f.history.save({project:'app',checked:checked()});
  for(const value of [checked(undefined,{specSha256:'b'.repeat(64)}),checked(undefined,{projectConfigurationSha256:'b'.repeat(64)}),checked([check('#different','fail')]),checked(undefined,{browserScope:{journeyViewport:390}})]) {
    const head=await f.history.save({project:'app',checked:value});
    const comparison=await f.history.compare({project:'app',baseId:base.id,headId:head.id});
    assert.equal(comparison.compatible,false);assert.equal(comparison.exitCode,2);assert.ok(comparison.reason);
  }
});

test('viewport observations can improve while matching width and height preserve comparison scope',async t=>{
  const f=await fixture(t);
  const overflow=(status,viewport)=>({...check('page',status),check:'layout',viewport,observed:{overflow:status==='fail'},fix:'Review horizontal overflow'});
  // runRunningCheck records measured scrollWidth beside configured viewport width.
  const base=await f.history.save({project:'app',checked:checked([overflow('fail',{width:390,scrollWidth:420})])});
  const head=await f.history.save({project:'app',checked:checked([overflow('pass',{width:390,scrollWidth:390})])});
  const fixed=await f.history.compare({project:'app',baseId:base.id,headId:head.id});
  assert.equal(fixed.compatible,true);assert.equal(fixed.resolved.length,1);assert.equal(fixed.exitCode,0);
  assert.equal(fixed.resolved[0].viewport.scrollWidth,390,'retain measurements in the evidence');
  const tall=await f.history.save({project:'app',checked:checked([overflow('fail',{width:390,height:900,scrollWidth:420})])});
  const short=await f.history.save({project:'app',checked:checked([overflow('pass',{width:390,height:700,scrollWidth:390})])});
  const resized=await f.history.compare({project:'app',baseId:tall.id,headId:short.id});
  assert.equal(resized.compatible,false);assert.equal(resized.exitCode,2);assert.match(resized.reason,/coverage|scope/i);
});

test('history rejects arbitrary IDs, paths, malformed reports and oversized files',async t=>{
  const f=await fixture(t);
  for(const id of ['../secret','a'.repeat(32)+'.json','C:\\secret','',null])await assert.rejects(f.history.read({project:'app',id}),/id/i);
  for(const project of ['../evidence','app/../other','app\\..\\other','/tmp','C:\\outside','app:secret',''])await assert.rejects(f.history.list({project}),/project|path/i);
  await assert.rejects(f.history.save({project:'app',checked:checked([])}),/report|binding|checks/i);
  await assert.rejects(f.history.save({project:'app',checked:checked(undefined,{status:'pass'})}),/report|binding/i);
  await assert.rejects(f.history.save({project:'app',checked:checked(undefined,{limitations:['x'.repeat(2_100_000)]})}),/large|limit/i);
  const entry=await f.history.save({project:'app',checked:checked()}),file=(await storedFiles(f.evidenceDirectory)).find(path=>path.endsWith(entry.id+'.report.json'));
  await writeFile(file,'x'.repeat(2_100_000));
  await assert.rejects(f.history.read({project:'app',id:entry.id}),/large|limit|unavailable/i);
  assert.equal((await f.history.list({project:'app'})).unavailableCount,1);
});

test('history refuses symlink traversal at workspace, project and evidence namespace boundaries',async t=>{
  const f=await fixture(t),alias=join(f.root,'alias');
  await symlink(f.workspace,alias,'junction');
  await assert.rejects(openStudioHistory({workspace:alias,evidenceDirectory:f.evidenceDirectory}),/symlink/i);
  const projectLink=join(f.workspace,'linked');await symlink(join(f.workspace,'app'),projectLink,'junction');
  await assert.rejects(f.history.save({project:'linked',checked:checked()}),/symlink/i);
  const entry=await f.history.save({project:'app',checked:checked()}),file=(await storedFiles(f.evidenceDirectory)).find(path=>path.endsWith(entry.id+'.report.json'));
  const directory=dirname(file),renamed=directory+'-moved';
  const {rename}=await import('node:fs/promises');await rename(directory,renamed);await symlink(renamed,directory,'junction');
  await assert.rejects(f.history.list({project:'app'}),/symlink/i);
});

test('100-entry cap bounds storage without deleting any evidence or user files',async t=>{
  const f=await fixture(t),unrelated=join(f.evidenceDirectory,'keep.txt');await writeFile(unrelated,'KEEP');
  let first;
  for(let i=0;i<100;i++){const entry=await f.history.save({project:'app',checked:checked()});first??=entry;}
  assert.equal((await f.history.list({project:'app'})).entries.length,100);
  await assert.rejects(f.history.save({project:'app',checked:checked()}),/100|limit|capacity/i);
  assert.equal((await f.history.read({project:'app',id:first.id})).entry.id,first.id);
  assert.equal(await readFile(unrelated,'utf8'),'KEEP');assert.equal((await storedFiles(f.evidenceDirectory)).length,201);
});

test('an evidence directory inside the workspace is rejected',async t=>{
  const f=await fixture(t);
  await assert.rejects(openStudioHistory({workspace:f.workspace,evidenceDirectory:join(f.workspace,'app')}),/outside/i);
});
