import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,cp,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startStudio} from '../scripts/studio.mjs';
import {loadProject,snapshotProject} from '../scripts/project-workflow.mjs';
import {findingId} from '../scripts/agent-brief.mjs';

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'studio-product-')),workspace=join(root,'workspace'),evidence=join(root,'evidence');
  await mkdir(workspace);await mkdir(evidence);
  const config={schemaVersion:1,files:['index.html'],journey:{buttons:['#open'],trigger:'#open',dialog:'#dialog',name:'Review',dialogButtons:['#close'],close:'#close'},targetPaths:{'#open':'index.html','#close':'index.html',dialog:'index.html',page:'index.html'}};
  await writeFile(join(workspace,'project.json'),JSON.stringify(config));await writeFile(join(workspace,'index.html'),'<button>OLD</button>');
  const check=async()=>{
    const project=await loadProject(join(workspace,'project.json')),snapshot=await snapshotProject(project);
    return {result:{report:{status:'fail',artifactSha256:snapshot.artifactSha256,specSha256:snapshot.contract.specSha256,projectConfigurationSha256:project.configHash,checks:[{ruleId:'target',check:'target',target:'#open',status:'fail',observed:24,expected:40,fix:'Increase target'}]},repair:{artifactSha256:snapshot.artifactSha256,specSha256:snapshot.contract.specSha256,findings:[{path:'index.html',status:'fail'}]}},summary:{status:'fail',exitCode:1},targetPaths:config.targetPaths};
  };
  let studio=await startStudio({workspace,evidenceDirectory:evidence,check});
  const post=async body=>{const response=await fetch(studio.origin+'/api',{method:'POST',headers:{'content-type':'application/json','x-stylecon-session':studio.token,origin:studio.origin},body:JSON.stringify({project:'.',...body})});return {status:response.status,data:await response.json()};};
  const restart=async()=>{await studio.close();studio=await startStudio({workspace,evidenceDirectory:evidence,check});};
  t.after(async()=>{await studio.close();await rm(root,{recursive:true,force:true});});
  return {workspace,evidence,post,restart};
}

test('Studio briefs reject stale source and history cannot restore repair or brief authority after restart',async t=>{
  const {workspace,post,restart}=await fixture(t);
  const checked=await post({action:'check'});assert.equal(checked.status,200,JSON.stringify(checked.data));
  const selectedIds=[findingId(checked.data.result.report.checks[0])];
  assert.equal((await post({action:'brief',selectedIds})).status,200);
  assert.equal((await post({action:'brief',selectedIds:[]})).status,400);
  await writeFile(join(workspace,'index.html'),'<button>CHANGED</button>');
  const stale=await post({action:'brief',selectedIds});assert.equal(stale.status,400);assert.match(stale.data.error,/stale/i);
  await restart();
  const list=await post({action:'history'});assert.equal(list.data.entries.length,1);
  const stored=await post({action:'history-read',id:list.data.entries[0].id});assert.equal(stored.status,200);
  assert.equal(stored.data.historyOnly,true);assert.equal(stored.data.checked.result.repair,undefined);
  assert.equal((await post({action:'brief',selectedIds})).status,400);
  assert.equal((await post({action:'preview',change:{path:'index.html',before:'CHANGED',after:'NEW'}})).status,400);
});

test('Studio review downloads require the exact preview and reject changed source or historical authority',async t=>{
  const {workspace,post,restart}=await fixture(t);
  assert.equal((await post({action:'review-preview'})).status,400);
  await post({action:'check'});
  assert.equal((await post({action:'review-download',packetSha256:'a'.repeat(64),format:'html'})).status,400);
  const preview=await post({action:'review-preview'});assert.equal(preview.status,200);
  const packetSha256=preview.data.packet.packetSha256;
  assert.equal((await post({action:'review-download',packetSha256:'a'.repeat(64),format:'html'})).status,400);
  assert.equal((await post({action:'review-download',packetSha256,format:'script'})).status,400);
  const html=await post({action:'review-download',packetSha256,format:'html'});assert.equal(html.status,200);
  assert.match(html.data.text,/Every recorded check/);assert.doesNotMatch(html.data.text,/#open|index.html|OLD/);
  const json=await post({action:'review-download',packetSha256,format:'json'});assert.deepEqual(JSON.parse(json.data.text),preview.data.packet);
  await writeFile(join(workspace,'index.html'),'<button>CHANGED</button>');
  assert.equal((await post({action:'review-download',packetSha256,format:'html'})).status,400);
  await restart();const list=await post({action:'history'});
  await post({action:'history-read',id:list.data.entries[0].id});
  assert.equal((await post({action:'review-preview'})).status,400);
  assert.equal((await post({action:'review-download',packetSha256,format:'json'})).status,400);
});

test('Studio creates a new snapshot, adopts only an exact reviewed hash and clears old evidence',async t=>{
  const {workspace,post}=await fixture(t);
  await mkdir(join(workspace,'rules'));await cp(fileURLToPath(new URL('../spec',import.meta.url)),join(workspace,'rules/spec'),{recursive:true});
  const originalConfig=await readFile(join(workspace,'project.json'),'utf8');
  assert.equal((await post({action:'snapshot',source:'rules',snapshotPath:'team.json'})).status,200);
  assert.equal((await post({action:'snapshot',source:'rules',snapshotPath:'team.json'})).status,400,'existing snapshot stays intact');
  assert.equal((await post({action:'snapshot',source:'rules',snapshotPath:'../outside.json'})).status,400);
  const checked=await post({action:'check'});assert.equal(checked.status,200);
  const preview=await post({action:'adopt-preview',snapshotPath:'team.json'});assert.equal(preview.status,200,JSON.stringify(preview.data));
  assert.equal(await readFile(join(workspace,'project.json'),'utf8'),originalConfig,'preview is read only');
  assert.equal((await post({action:'adopt',previewSha256:'wrong'})).status,400);
  const adopted=await post({action:'adopt',previewSha256:preview.data.previewSha256});assert.equal(adopted.status,200,JSON.stringify(adopted.data));
  assert.equal(JSON.parse(await readFile(join(workspace,'project.json'),'utf8')).constitution.path,'team.json');
  assert.equal((await post({action:'brief',selectedIds:checked.data.findingIds})).status,400);
  assert.equal((await post({action:'check'})).status,200);
  const history=await post({action:'history'});
  const compare=await post({action:'history-compare',baseId:history.data.entries[1].id,headId:history.data.entries[0].id});
  assert.equal(compare.data.compatible,false,'different rule pins cannot establish resolution');
});

test('Studio refuses a rules spec alias outside the workspace before snapshot creation',async t=>{
  const {workspace,evidence,post}=await fixture(t);
  await cp(fileURLToPath(new URL('../spec',import.meta.url)),join(evidence,'external-spec'),{recursive:true});
  await mkdir(join(workspace,'linked-rules'));
  try{await symlink(join(evidence,'external-spec'),join(workspace,'linked-rules/spec'),process.platform==='win32'?'junction':'dir');}
  catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('Directory links unavailable on this host');return;}throw error;}
  const result=await post({action:'snapshot',source:'linked-rules',snapshotPath:'external.json'});
  assert.equal(result.status,400);assert.match(result.data.error,/Symlinks/);
  await assert.rejects(readFile(join(workspace,'external.json')),{code:'ENOENT'});
});
