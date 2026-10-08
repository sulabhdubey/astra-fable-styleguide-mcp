import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {pinConstitution} from '../scripts/constitution.mjs';
import {previewConstitutionAdoption,applyConstitutionAdoption,recoverConstitutionAdoption,constitutionAdoptionStatus} from '../scripts/constitution-adoption.mjs';
import {loadProject,snapshotProject} from '../scripts/project-workflow.mjs';
import {loadRunningProject} from '../scripts/running-app.mjs';
import {evaluateObservations} from '../packages/browser-verification/src/index.mjs';

const repository=resolve(import.meta.dirname,'..');
const snapshotOptions={snapshotPath:'candidate.json'};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function inventory(root,prefix='') {
  const files={};
  for(const entry of (await fs.readdir(join(root,prefix),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
    const path=prefix+entry.name;
    if(entry.isDirectory())Object.assign(files,await inventory(root,path+'/'));else files[path]=digest(await fs.readFile(join(root,path)));
  }
  return files;
}
async function fixture(running=false,pinned=false) {
  const temp=await fs.mkdtemp(join(tmpdir(),'constitution-adoption-')),root=join(temp,'project'),source=join(temp,'source');
  await fs.cp(join(repository,'spec'),join(source,'spec'),{recursive:true});
  await fs.mkdir(root);
  const evidenceDirectory=join(temp,'private-evidence');await fs.mkdir(evidenceDirectory);
  let config;
  if(running) {
    await fs.mkdir(join(root,'src'));await fs.mkdir(join(root,'dist'));
    await fs.writeFile(join(root,'src/App.jsx'),'export default function App(){}\n');
    await fs.writeFile(join(root,'dist/index.html'),'<!doctype html><main></main>\n');
    await fs.writeFile(join(root,'package.json'),'{"private":true}\n');
    config={schemaVersion:2,integration:'vite-preview',url:'http://127.0.0.1:4173/',sourceDirectory:'src',buildDirectory:'dist',identityFiles:['package.json'],
      journey:{buttons:['#open'],trigger:'#open',dialog:'#dialog',name:'Review',dialogButtons:['#close'],close:'#close'},
      targetPaths:{'#open':'src/App.jsx','#close':'src/App.jsx','#title':'src/App.jsx',dialog:'src/App.jsx',page:'src/App.jsx'},
      measurements:[{selector:'#title',target:'#title',typography:{fontSize:'typography.fontSize.500'}}]};
  }else {
    await fs.cp(join(repository,'examples/profile'),root,{recursive:true});
    config=JSON.parse(await fs.readFile(join(root,'project.json'),'utf8'));
  }
  const prior=await pinConstitution(source,join(root,'prior.json'));
  if(pinned)config.constitution={path:'prior.json',sha256:prior.sha256};
  const buttonPath=join(source,'spec/components/button.json'),button=JSON.parse(await fs.readFile(buttonPath,'utf8'));
  button.accessibility.minimumTarget='48px';await fs.writeFile(buttonPath,JSON.stringify(button));
  const typographyPath=join(source,'spec/tokens/typography.json'),typography=JSON.parse(await fs.readFile(typographyPath,'utf8'));
  typography.typography.fontSize['500'].$value='28px';await fs.writeFile(typographyPath,JSON.stringify(typography));
  const candidate=await pinConstitution(source,join(root,'candidate.json'));
  const configPath=join(root,'project.json');await fs.writeFile(configPath,JSON.stringify(config,null,2)+'\n');
  const identity=process.platform==='win32'?configPath.toLowerCase():configPath;
  const journalDirectory=join(evidenceDirectory,`constitution-adoption-${digest(identity)}`);
  return {temp,root,source,configPath,config,candidate,evidenceDirectory,journalDirectory,options:{...snapshotOptions,evidenceDirectory},cleanup:()=>fs.rm(temp,{recursive:true,force:true})};
}

for(const running of [false,true])for(const pinned of [false,true])test(`${running?'Vite':'static'} ${pinned?'pinned':'bundled'} adoption previews actual rules and changes only the reviewed config pin`,async()=>{
  const f=await fixture(running,pinned);
  try {
    const canonicalBefore=await inventory(join(repository,'spec')),projectBefore=await inventory(f.root),sourceBefore=await inventory(f.source);
    const preview=await previewConstitutionAdoption(f.configPath,f.options);
    assert.deepEqual(await inventory(f.root),projectBefore,'preview is read only');
    assert.deepEqual(await inventory(f.evidenceDirectory),{},'preview does not create private journals');
    assert.equal(preview.before.checkedRules.minimumTarget,40);assert.equal(preview.after.checkedRules.minimumTarget,48);
    assert.deepEqual(preview.checkedRuleDiff.find(item=>item.path==='minimumTarget'),{path:'minimumTarget',before:40,after:48});
    if(running)assert.deepEqual(preview.checkedRuleDiff.find(item=>item.path==='measurements.#title.typography.fontSize'),{path:'measurements.#title.typography.fontSize',before:'24px',after:'28px'});
    assert.equal(preview.after.constitution.sha256,f.candidate.sha256);assert.equal(preview.requiresRecheck,true);
    const result=await applyConstitutionAdoption(f.configPath,f.options,preview.previewSha256);
    assert.equal(result.requiresRecheck,true);
    const config=JSON.parse(await fs.readFile(f.configPath,'utf8'));
    assert.deepEqual(config,{...f.config,constitution:{path:'candidate.json',sha256:f.candidate.sha256}});
    const loaded=running?await loadRunningProject(f.configPath):await snapshotProject(await loadProject(f.configPath));
    const report=evaluateObservations(loaded.contract,{buttons:[{selector:'#open',visible:true,width:44,height:44}]});
    assert.equal(report.checks.find(item=>item.check==='target').status,'fail','48px rule reaches the real verifier');
    if(running)assert.equal(loaded.measurements[0].expected.typography.fontSize,'28px');
    for(const [path,sha] of Object.entries(projectBefore))if(path!=='project.json')assert.equal(digest(await fs.readFile(join(f.root,path))),sha);
    assert.deepEqual(Object.keys(await inventory(f.root)),Object.keys(projectBefore),'no journal, backup or staged config is added to the project');
    assert.ok(result.receiptPath.startsWith(f.journalDirectory));
    assert.deepEqual(await inventory(join(repository,'spec')),canonicalBefore);assert.deepEqual(await inventory(f.source),sourceBefore);
    const receipt=JSON.parse(await fs.readFile(result.receiptPath,'utf8'));
    assert.equal(receipt.preview.previewSha256,preview.previewSha256);assert.equal(digest(Buffer.from(receipt.original,'base64')),projectBefore['project.json']);
    await assert.rejects(applyConstitutionAdoption(f.configPath,f.options,preview.previewSha256),/already uses/);
  }finally{await f.cleanup();}
});

test('approval is required and bound to project, config, snapshot, previous pin, source, build and identity bytes',async()=>{
  for(const change of ['none','config','snapshot','prior','source','build','identity','different-project']) {
    const f=await fixture(true,true);let other;
    try {
      const preview=await previewConstitutionAdoption(f.configPath,f.options);
      await assert.rejects(applyConstitutionAdoption(f.configPath,f.options),/exact.*SHA-256/);
      await assert.rejects(applyConstitutionAdoption(f.configPath,f.options,'0'.repeat(64)),/Stale/);
      if(change==='config')await fs.appendFile(f.configPath,'\n');
      if(change==='snapshot')await fs.appendFile(join(f.root,'candidate.json'),'\n');
      if(change==='prior')await fs.appendFile(join(f.root,'prior.json'),'\n');
      if(change==='source')await fs.appendFile(join(f.root,'src/App.jsx'),'// edit\n');
      if(change==='build')await fs.appendFile(join(f.root,'dist/index.html'),'<!-- edit -->');
      if(change==='identity')await fs.appendFile(join(f.root,'package.json'),'\n');
      if(change==='different-project'){other=await fixture(true,true);}
      if(change!=='none') {
        const path=other?.configPath??f.configPath,original=await fs.readFile(path);
        await assert.rejects(applyConstitutionAdoption(path,other?.options??f.options,preview.previewSha256),/Stale|pin changed/);
        assert.deepEqual(await fs.readFile(path),original);
      }
    }finally{await f.cleanup();if(other)await other.cleanup();}
  }
});

test('static source mutations and invalid candidate paths are refused without writes',async()=>{
  const f=await fixture();
  try {
    const preview=await previewConstitutionAdoption(f.configPath,f.options);
    await fs.appendFile(join(f.root,'index.html'),'<!-- changed -->');
    await assert.rejects(applyConstitutionAdoption(f.configPath,f.options,preview.previewSha256),/Stale/);
    for(const snapshotPath of ['../candidate.json',join(f.root,'candidate.json'),'project.json'])await assert.rejects(previewConstitutionAdoption(f.configPath,{...f.options,snapshotPath}),/inside the project/);
    await fs.writeFile(join(f.root,'invalid.json'),'{"schemaVersion":1,"files":{}}');
    await assert.rejects(previewConstitutionAdoption(f.configPath,{...f.options,snapshotPath:'invalid.json'}),/Invalid/);
    const text=await fs.readFile(f.configPath,'utf8');await fs.writeFile(f.configPath,text.replace('"schemaVersion": 1','"schemaVersion": 1, "schemaVersion": 1'));
    await assert.rejects(previewConstitutionAdoption(f.configPath,f.options),/Duplicate/);
  }finally{await f.cleanup();}
});

test('a failed exclusive install restores the exact original and leaves a recovery receipt',async t=>{
  const f=await fixture();
  try {
    const original=await fs.readFile(f.configPath),preview=await previewConstitutionAdoption(f.configPath,f.options),link=fs.link;
    t.mock.method(fs,'link',async(from,to)=>{if(from.endsWith('candidate.json'))throw new Error('simulated install failure');return link(from,to);});
    await assert.rejects(applyConstitutionAdoption(f.configPath,f.options,preview.previewSha256),/simulated install failure.*not applied/);
    assert.deepEqual(await fs.readFile(f.configPath),original);
    assert.ok((await fs.readdir(f.journalDirectory)).some(name=>name.startsWith('aborted-')));
    assert.equal((await fs.lstat(f.configPath)).nlink,1);
    t.mock.restoreAll();assert.equal((await previewConstitutionAdoption(f.configPath,f.options)).previewSha256,preview.previewSha256);
  }finally{t.mock.restoreAll();await f.cleanup();}
});

test('an external edit immediately before moving config is preserved',async t=>{
  const f=await fixture();
  try {
    const preview=await previewConstitutionAdoption(f.configPath,f.options),rename=fs.rename;
    const external=JSON.stringify({...f.config,journey:{...f.config.journey,name:'External edit'}});
    t.mock.method(fs,'rename',async(from,to)=>{if(from===f.configPath)await fs.writeFile(from,external);return rename(from,to);});
    await assert.rejects(applyConstitutionAdoption(f.configPath,f.options,preview.previewSha256),/external bytes preserved/);
    assert.equal(await fs.readFile(f.configPath,'utf8'),external);
  }finally{t.mock.restoreAll();await f.cleanup();}
});

test('an externally recreated config blocks install and recovery without overwriting either version',async t=>{
  const f=await fixture();
  try {
    const original=await fs.readFile(f.configPath),preview=await previewConstitutionAdoption(f.configPath,f.options),link=fs.link;
    const external=JSON.stringify({...f.config,journey:{...f.config.journey,name:'Competing writer'}});
    t.mock.method(fs,'link',async(from,to)=>{if(from.endsWith('candidate.json'))await fs.writeFile(to,external,{flag:'wx'});return link(from,to);});
    await assert.rejects(applyConstitutionAdoption(f.configPath,f.options,preview.previewSha256),/requires recovery/);
    t.mock.restoreAll();assert.equal(await fs.readFile(f.configPath,'utf8'),external);
    await assert.rejects(recoverConstitutionAdoption(f.configPath,f.options),/external configuration changes/);
    assert.deepEqual(await fs.readFile(join(f.journalDirectory,'pending/displaced.json')),original);
    await assert.rejects(previewConstitutionAdoption(f.configPath,f.options),/requires recovery/);
    await fs.unlink(f.configPath);
    assert.equal((await recoverConstitutionAdoption(f.configPath,f.options)).outcome,'original-restored');
    assert.deepEqual(await fs.readFile(f.configPath),original);
  }finally{t.mock.restoreAll();await f.cleanup();}
});

test('post-install failure remains pending and explicit recovery restores original bytes',async t=>{
  const f=await fixture();
  try {
    const original=await fs.readFile(f.configPath),preview=await previewConstitutionAdoption(f.configPath,f.options),open=fs.open;
    t.mock.method(fs,'open',async(path,...args)=>{if(path.endsWith('committed.json'))throw new Error('simulated journal completion failure');return open(path,...args);});
    await assert.rejects(applyConstitutionAdoption(f.configPath,f.options,preview.previewSha256),/requires recovery/);
    t.mock.restoreAll();assert.equal(JSON.parse(await fs.readFile(f.configPath,'utf8')).constitution.sha256,f.candidate.sha256);
    assert.equal((await recoverConstitutionAdoption(f.configPath,f.options)).outcome,'original-restored');
    assert.deepEqual(await fs.readFile(f.configPath),original);
    assert.equal((await fs.lstat(f.configPath)).nlink,1);
  }finally{t.mock.restoreAll();await f.cleanup();}
});

test('recovery refuses a tampered journal and supports a durable committed adoption',async t=>{
  const f=await fixture();
  try {
    const preview=await previewConstitutionAdoption(f.configPath,f.options),rename=fs.rename;
    t.mock.method(fs,'rename',async(from,to)=>{if(from.endsWith('pending'))throw new Error('simulated archive failure');return rename(from,to);});
    await assert.rejects(applyConstitutionAdoption(f.configPath,f.options,preview.previewSha256),/requires recovery/);
    t.mock.restoreAll();const journalPath=join(f.journalDirectory,'pending/journal.json'),journal=await fs.readFile(journalPath);
    const modified=JSON.parse(journal);modified.original=Buffer.from('{}').toString('base64');await fs.writeFile(journalPath,JSON.stringify(modified));
    await assert.rejects(recoverConstitutionAdoption(f.configPath,f.options),/Invalid adoption recovery binding/);
    await fs.writeFile(journalPath,journal);
    assert.equal((await recoverConstitutionAdoption(f.configPath,f.options)).outcome,'adopted');
    assert.equal(JSON.parse(await fs.readFile(f.configPath,'utf8')).constitution.sha256,f.candidate.sha256);
  }finally{t.mock.restoreAll();await f.cleanup();}
});

for(const point of ['install','restore'])test(`recovery accepts only journaled hard links left after ${point}`,async t=>{
  const f=await fixture();
  try {
    const original=await fs.readFile(f.configPath),preview=await previewConstitutionAdoption(f.configPath,f.options),unlink=fs.unlink,link=fs.link;
    if(point==='restore')t.mock.method(fs,'link',async(from,to)=>{if(from.endsWith('candidate.json'))throw new Error('simulated install failure');return link(from,to);});
    t.mock.method(fs,'unlink',async path=>{if(path.endsWith(point==='install'?'candidate.json':'displaced.json'))throw new Error('simulated interrupted unlink');return unlink(path);});
    await assert.rejects(applyConstitutionAdoption(f.configPath,f.options,preview.previewSha256),/requires recovery/);
    t.mock.restoreAll();assert.equal((await fs.lstat(f.configPath)).nlink,2);
    await assert.rejects(previewConstitutionAdoption(f.configPath,f.options),/configuration file or link/);
    assert.equal((await recoverConstitutionAdoption(f.configPath,f.options)).outcome,'original-restored');
    assert.deepEqual(await fs.readFile(f.configPath),original);assert.equal((await fs.lstat(f.configPath)).nlink,1);
    assert.equal((await previewConstitutionAdoption(f.configPath,f.options)).previewSha256,preview.previewSha256);
  }finally{t.mock.restoreAll();await f.cleanup();}
});

test('recovery rejects unrecognized hard links and corrupted backup bytes before removing current config',async t=>{
  const f=await fixture();
  try {
    const preview=await previewConstitutionAdoption(f.configPath,f.options),open=fs.open;
    t.mock.method(fs,'open',async(path,...args)=>{if(path.endsWith('committed.json'))throw new Error('simulated completion failure');return open(path,...args);});
    await assert.rejects(applyConstitutionAdoption(f.configPath,f.options,preview.previewSha256),/requires recovery/);t.mock.restoreAll();
    const installed=await fs.readFile(f.configPath),alias=join(f.root,'external-copy.json');await fs.link(f.configPath,alias);
    await assert.rejects(recoverConstitutionAdoption(f.configPath,f.options),/unrecognized configuration hard links/);await fs.unlink(alias);
    const backup=join(f.journalDirectory,'pending/displaced.json');await fs.appendFile(backup,'\n');
    await assert.rejects(recoverConstitutionAdoption(f.configPath,f.options),/Invalid adoption backup/);
    assert.deepEqual(await fs.readFile(f.configPath),installed);
  }finally{t.mock.restoreAll();await f.cleanup();}
});

test('private evidence is required, outside the project, existing, and bound to the reviewed approval',async()=>{
  const f=await fixture();
  try {
    const before=await inventory(f.root);
    for(const evidenceDirectory of [undefined,'relative-evidence',f.root,join(f.root,'src'),join(f.temp,'missing'),join(repository,'spec')]) {
      await assert.rejects(previewConstitutionAdoption(f.configPath,{...snapshotOptions,evidenceDirectory}),/absolute private|outside the project|ENOENT|Canonical/);
    }
    assert.deepEqual(await inventory(f.root),before);assert.deepEqual(await inventory(f.evidenceDirectory),{});
    const preview=await previewConstitutionAdoption(f.configPath,f.options),otherEvidence=join(f.temp,'other-evidence');await fs.mkdir(otherEvidence);
    await assert.rejects(applyConstitutionAdoption(f.configPath,{...f.options,evidenceDirectory:otherEvidence},preview.previewSha256),/Stale/);
    assert.deepEqual(await inventory(otherEvidence),{});
  }finally{await f.cleanup();}
});

test('different-filesystem evidence refuses preview and apply before any directory or config mutation',async t=>{
  const f=await fixture();
  try {
    const preview=await previewConstitutionAdoption(f.configPath,f.options),before=await inventory(f.root),stat=fs.stat;
    t.mock.method(fs,'stat',async(path,...args)=>{const info=await stat(path,...args);if(path===f.evidenceDirectory)info.dev+=1;return info;});
    const rename=t.mock.method(fs,'rename',async()=>{throw new Error('rename must not run');});
    const mkdir=t.mock.method(fs,'mkdir',async()=>{throw new Error('mkdir must not run');});
    assert.deepEqual(await constitutionAdoptionStatus(f.configPath,f.options),{pending:false});
    await assert.rejects(previewConstitutionAdoption(f.configPath,f.options),/Cross-filesystem/);
    await assert.rejects(applyConstitutionAdoption(f.configPath,f.options,preview.previewSha256),/Cross-filesystem/);
    assert.equal(rename.mock.callCount(),0);assert.equal(mkdir.mock.callCount(),0);
    assert.deepEqual(await inventory(f.root),before);assert.deepEqual(await inventory(f.evidenceDirectory),{});
  }finally{t.mock.restoreAll();await f.cleanup();}
});

test('adoption status is read only for ordinary, missing-config and interrupted projects',async t=>{
  const f=await fixture();
  try {
    assert.deepEqual(await constitutionAdoptionStatus(f.configPath,f.options),{pending:false});
    const original=await fs.readFile(f.configPath);await fs.unlink(f.configPath);
    assert.deepEqual(await constitutionAdoptionStatus(f.configPath,f.options),{pending:false});
    await fs.writeFile(f.configPath,'{');assert.deepEqual(await constitutionAdoptionStatus(f.configPath,f.options),{pending:false});
    await fs.writeFile(f.configPath,original);
    const preview=await previewConstitutionAdoption(f.configPath,f.options),open=fs.open;
    t.mock.method(fs,'open',async(path,...args)=>{if(path.endsWith('committed.json'))throw new Error('simulated completion failure');return open(path,...args);});
    await assert.rejects(applyConstitutionAdoption(f.configPath,f.options,preview.previewSha256),/requires recovery/);t.mock.restoreAll();
    const before=await inventory(f.temp);assert.deepEqual(await constitutionAdoptionStatus(f.configPath,f.options),{pending:true});
    assert.deepEqual(await inventory(f.temp),before);
    await fs.unlink(f.configPath);assert.deepEqual(await constitutionAdoptionStatus(f.configPath,f.options),{pending:true});
    assert.equal((await recoverConstitutionAdoption(f.configPath,f.options)).outcome,'original-restored');
    assert.deepEqual(await constitutionAdoptionStatus(f.configPath,f.options),{pending:false});
    await fs.writeFile(join(f.journalDirectory,'pending'),'invalid journal entry');
    assert.equal((await constitutionAdoptionStatus(f.configPath,f.options)).pending,true);
  }finally{t.mock.restoreAll();await f.cleanup();}
});

test('shared private evidence keeps journals for distinct projects in separate namespaces',async()=>{
  const first=await fixture(),second=await fixture();
  try {
    const secondOptions={...second.options,evidenceDirectory:first.evidenceDirectory};
    const a=await previewConstitutionAdoption(first.configPath,first.options),b=await previewConstitutionAdoption(second.configPath,secondOptions);
    assert.notEqual(a.previewSha256,b.previewSha256);
    const adoptedA=await applyConstitutionAdoption(first.configPath,first.options,a.previewSha256);
    const adoptedB=await applyConstitutionAdoption(second.configPath,secondOptions,b.previewSha256);
    assert.notEqual(adoptedA.receiptPath,adoptedB.receiptPath);
    assert.equal((await fs.readdir(first.evidenceDirectory)).length,2);
    assert.deepEqual(await constitutionAdoptionStatus(first.configPath,first.options),{pending:false});
    assert.deepEqual(await constitutionAdoptionStatus(second.configPath,secondOptions),{pending:false});
  }finally{await first.cleanup();await second.cleanup();}
});
