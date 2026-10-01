import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startStudio} from '../scripts/studio.mjs';
import {loadProject,snapshotProject} from '../scripts/project-workflow.mjs';

test('studio rejects cross-origin, unauthenticated and escaping requests without exposing project files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'style-studio-'));
  const workspace=join(root,'workspace'),evidence=join(root,'evidence');await mkdir(workspace);await mkdir(evidence);
  await writeFile(join(workspace,'secret.txt'),'private sentinel');
  const studio=await startStudio({workspace,evidenceDirectory:evidence});
  const post=(body,headers={})=>fetch(studio.origin+'/api',{method:'POST',headers:{'content-type':'application/json','x-stylecon-session':studio.token,origin:studio.origin,...headers},body:JSON.stringify(body)});
  try {
    assert.equal((await fetch(studio.origin+'/secret.txt')).status,404);
    assert.equal((await post({action:'projects'},{origin:'https://hostile.invalid'})).status,403);
    assert.equal((await post({action:'projects'},{'x-stylecon-session':'wrong'})).status,403);
    assert.equal((await post({action:'check',project:'../secret.txt'})).status,400);
    assert.equal((await post({action:'projects'})).status,200);
    assert.equal((await fetch(studio.origin+'/')).headers.get('content-security-policy').includes("connect-src 'self'"),true);
    const response=await post({action:'init',project:'.',options:{}});
    assert.equal(response.status,400);
  }finally{await studio.close();await rm(root,{recursive:true,force:true});}
});

test('studio rejects wrong preview hashes and stale source without applying corrections',async()=>{
  const root=await mkdtemp(join(tmpdir(),'style-studio-stale-')),workspace=join(root,'workspace'),evidence=join(root,'evidence');await mkdir(workspace);await mkdir(evidence);
  const config={schemaVersion:1,files:['index.html'],journey:{buttons:['#open'],trigger:'#open',dialog:'#dialog',name:'Review',dialogButtons:['#close'],close:'#close'},targetPaths:{'#open':'index.html','#close':'index.html',dialog:'index.html',page:'index.html'}};
  await writeFile(join(workspace,'project.json'),JSON.stringify(config));await writeFile(join(workspace,'index.html'),'<button>OLD</button>');
  const project=await loadProject(join(workspace,'project.json')),snapshot=await snapshotProject(project);
  const checked={result:{report:{status:'fail',artifactSha256:snapshot.artifactSha256,specSha256:snapshot.contract.specSha256,projectConfigurationSha256:project.configHash,checks:[{ruleId:'target',check:'target',target:'#open',status:'fail',fix:'Correct target'}]},repair:{artifactSha256:snapshot.artifactSha256,specSha256:snapshot.contract.specSha256,findings:[{path:'index.html',status:'fail'}]}},summary:{status:'fail',exitCode:1},targetPaths:config.targetPaths};
  const studio=await startStudio({workspace,evidenceDirectory:evidence,check:async()=>checked});
  const post=async body=>{const response=await fetch(studio.origin+'/api',{method:'POST',headers:{'content-type':'application/json','x-stylecon-session':studio.token,origin:studio.origin},body:JSON.stringify({project:'.',...body})});return {status:response.status,data:await response.json()};};
  try {
    assert.equal((await post({action:'check'})).status,200);
    const preview=await post({action:'preview',change:{path:'index.html',before:'OLD',after:'NEW'}});assert.equal(preview.status,200);
    assert.equal((await post({action:'apply',previewSha256:'wrong'})).status,400);
    await writeFile(join(workspace,'index.html'),'<button>CHANGED</button>');
    assert.equal((await post({action:'apply',previewSha256:preview.data.previewSha256})).status,400);
    assert.equal(await readFile(join(workspace,'index.html'),'utf8'),'<button>CHANGED</button>');
  }finally{await studio.close();await rm(root,{recursive:true,force:true});}
});
