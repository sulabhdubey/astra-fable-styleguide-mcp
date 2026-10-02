import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startStudio} from '../scripts/studio.mjs';
import {loadProject,snapshotProject} from '../scripts/project-workflow.mjs';

test('guided Vite setup reviews canonical values, refuses stale saves and never overwrites configuration',async()=>{
  const root=await mkdtemp(join(tmpdir(),'style-studio-setup-'));
  const workspace=join(root,'workspace'),evidence=join(root,'evidence');await mkdir(workspace);await mkdir(evidence);
  await mkdir(join(workspace,'src'));await mkdir(join(workspace,'dist'));
  await writeFile(join(workspace,'src/App.jsx'),'export default function App(){}');
  await writeFile(join(workspace,'dist/index.html'),'<main></main>');
  await writeFile(join(workspace,'index.html'),'<div id="root"></div>');
  await writeFile(join(workspace,'package.json'),'{"scripts":{"build":"must never execute"}}');
  const studio=await startStudio({workspace,evidenceDirectory:evidence});
  const post=async body=>{const response=await fetch(studio.origin+'/api',{method:'POST',headers:{'content-type':'application/json','x-stylecon-session':studio.token,origin:studio.origin},body:JSON.stringify({project:'.',...body})});return {status:response.status,data:await response.json()};};
  const options={url:'http://127.0.0.1:4173/',sourceDirectory:'src',buildDirectory:'dist',identityFiles:'package.json',sourcePath:'src/App.jsx',trigger:'#open',dialog:'#dialog',close:'#close',name:'Review',measurement:'#title',fontSize:'typography.fontSize.500',paddingTop:'space.4'};
  try {
    const preview=await post({action:'setup-preview',options});assert.equal(preview.status,200,JSON.stringify(preview.data));
    assert.equal(preview.data.measurements[0].expected.typography.fontSize,'24px');
    assert.equal(preview.data.browserTargetsVerified,false);
    assert.equal((await readdir(workspace)).includes('project.json'),false);
    assert.equal((await post({action:'setup-save',previewSha256:'wrong'})).status,400);
    await writeFile(join(workspace,'src/App.jsx'),'changed');
    assert.equal((await post({action:'setup-save',previewSha256:preview.data.previewSha256})).status,400);
    const fresh=await post({action:'setup-preview',options});assert.equal(fresh.status,200);
    await writeFile(join(workspace,'project.json'),'{"externalEdit":true}');
    assert.equal((await post({action:'setup-save',previewSha256:fresh.data.previewSha256})).status,400);
    assert.equal(await readFile(join(workspace,'project.json'),'utf8'),'{"externalEdit":true}','a configuration created after review must remain untouched');
    await rm(join(workspace,'project.json'));
    assert.equal((await post({action:'setup-save',previewSha256:fresh.data.previewSha256})).status,200);
    const saved=await readFile(join(workspace,'project.json'),'utf8');assert.equal(JSON.parse(saved).schemaVersion,2);
    assert.equal((await post({action:'setup-save',previewSha256:fresh.data.previewSha256})).status,400);
    assert.equal(await readFile(join(workspace,'project.json'),'utf8'),saved);
    assert.equal((await readdir(workspace)).some(name=>name.startsWith('.stylecon-')),false);
  }finally{await studio.close();await rm(root,{recursive:true,force:true});}
});

test('guided Vite setup rejects unsafe origins, missing builds, invalid mappings and rules before creating configuration',async()=>{
  const root=await mkdtemp(join(tmpdir(),'style-studio-invalid-')),workspace=join(root,'workspace'),evidence=join(root,'evidence');await mkdir(workspace);await mkdir(evidence);
  await mkdir(join(workspace,'src'));await mkdir(join(workspace,'dist'));await writeFile(join(workspace,'src/App.jsx'),'source');await writeFile(join(workspace,'dist/index.html'),'build');await writeFile(join(workspace,'package.json'),'{}');
  const studio=await startStudio({workspace,evidenceDirectory:evidence});
  const options={url:'http://127.0.0.1:4173/',sourceDirectory:'src',buildDirectory:'dist',identityFiles:'package.json',sourcePath:'src/App.jsx',trigger:'#open',dialog:'#dialog',close:'#close',name:'Review',measurement:'#title',fontSize:'typography.fontSize.500',paddingTop:'space.4'};
  try {
    for(const change of [{url:'https://example.com/'},{sourcePath:'../outside.jsx'},{buildDirectory:'missing'},{fontSize:'invented.token'},{fontSize:'',paddingTop:''},{trigger:'#dialog'}]){
      const response=await fetch(studio.origin+'/api',{method:'POST',headers:{'content-type':'application/json','x-stylecon-session':studio.token,origin:studio.origin},body:JSON.stringify({action:'setup-preview',project:'.',options:{...options,...change}})});
      assert.equal(response.status,400);assert.equal((await readdir(workspace)).includes('project.json'),false);
    }
    const response=await fetch(studio.origin+'/api',{method:'POST',headers:{'content-type':'application/json','x-stylecon-session':studio.token,origin:studio.origin},body:JSON.stringify({action:'setup-preview',project:'.',options})});
    assert.equal(response.status,200,'a valid request must reach validation successfully');
  }finally{await studio.close();await rm(root,{recursive:true,force:true});}
});

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
  let failCheck=false;
  const studio=await startStudio({workspace,evidenceDirectory:evidence,check:async()=>{if(failCheck)throw new Error('Preview unavailable');return checked;}});
  const post=async body=>{const response=await fetch(studio.origin+'/api',{method:'POST',headers:{'content-type':'application/json','x-stylecon-session':studio.token,origin:studio.origin},body:JSON.stringify({project:'.',...body})});return {status:response.status,data:await response.json()};};
  try {
    assert.equal((await post({action:'check'})).status,200);
    const preview=await post({action:'preview',change:{path:'index.html',before:'OLD',after:'NEW'}});assert.equal(preview.status,200);
    assert.equal((await post({action:'apply',previewSha256:'wrong'})).status,400);
    failCheck=true;assert.equal((await post({action:'check'})).status,400);
    assert.equal((await post({action:'preview',change:{path:'index.html',before:'OLD',after:'NEW'}})).status,400,'failed recheck must invalidate earlier repair evidence');
    failCheck=false;assert.equal((await post({action:'check'})).status,200);
    const renewed=await post({action:'preview',change:{path:'index.html',before:'OLD',after:'NEW'}});assert.equal(renewed.status,200);
    await writeFile(join(workspace,'index.html'),'<button>CHANGED</button>');
    assert.equal((await post({action:'apply',previewSha256:renewed.data.previewSha256})).status,400);
    assert.equal(await readFile(join(workspace,'index.html'),'utf8'),'<button>CHANGED</button>');
  }finally{await studio.close();await rm(root,{recursive:true,force:true});}
});
