import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {loadProject, snapshotProject} from '../scripts/project-workflow.mjs';
import {formatReport} from '../scripts/standalone-check.mjs';
import {pinConstitution,loadPinnedConstitution} from '../scripts/constitution.mjs';
import {createRepairPacket,evaluateObservations} from '../packages/browser-verification/src/index.mjs';

const root=resolve(import.meta.dirname,'..');
const cli=join(root,'packages/cli/dist/stylecon.mjs');
const run=args=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});

test('init configures an existing supported page without editing it and refuses overwrite',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'style-init-'));
  try{
    await cp(join(root,'examples/profile/index.html'),join(temp,'index.html'));
    const before=await readFile(join(temp,'index.html'),'utf8');
    const args=['init',temp,'--files','index.html','--trigger','#review','--dialog','#review-dialog','--close','#back','--name','Confirm display name','--yes'];
    const result=run(args); assert.equal(result.status,0,result.stderr);
    const project=await loadProject(join(temp,'project.json'));
    assert.equal(project.config.journey.trigger,'#review');
    assert.equal(await readFile(join(temp,'index.html'),'utf8'),before);
    assert.equal(run(args).status,2);
    assert.equal(run(['init',temp,'--files','../bad.html','--yes']).status,2);
  }finally{await rm(temp,{recursive:true,force:true});}
});

test('distinct validated constitutions change target rules and invalidate old repair evidence',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'style-two-constitutions-'));
  try{
    const source=join(temp,'source');await cp(join(root,'spec'),join(source,'spec'),{recursive:true});
    const pinA=await pinConstitution(source,join(temp,'a.json'));
    const path=join(source,'spec/components/button.json');const button=JSON.parse(await readFile(path,'utf8'));button.accessibility.minimumTarget='48px';await writeFile(path,JSON.stringify(button));
    const pinB=await pinConstitution(source,join(temp,'b.json'));
    const a=await loadPinnedConstitution(temp,{path:'a.json',sha256:pinA.sha256});
    const b=await loadPinnedConstitution(temp,{path:'b.json',sha256:pinB.sha256});
    assert.equal(a.contract.minimumTarget,40);assert.equal(b.contract.minimumTarget,48);assert.notEqual(a.contract.specSha256,b.contract.specSha256);
    const observed={buttons:[{selector:'#button',visible:true,width:44,height:44}]};
    const ra=evaluateObservations(a.contract,observed,{artifactSha256:'a'.repeat(64)}),rb=evaluateObservations(b.contract,observed,{artifactSha256:'a'.repeat(64)});
    assert.equal(ra.checks.find(c=>c.check==='target').status,'pass');assert.equal(rb.checks.find(c=>c.check==='target').status,'fail');
    assert.throws(()=>createRepairPacket({report:ra,expectedSpecSha256:b.contract.specSha256,expectedArtifactSha256:'a'.repeat(64),targetPaths:{}}),/Stale/);
    await assert.rejects(pinConstitution(source,join(temp,'a.json')),/EEXIST/);
    await assert.rejects(loadPinnedConstitution(temp,{path:'../a.json',sha256:pinA.sha256}),/Invalid/);
    await assert.rejects(pinConstitution(source,join(source,'spec','export.json')),/canonical/i);
  }finally{await rm(temp,{recursive:true,force:true});}
});

test('HTML reports escape source text and distinguish compatible rechecks from changed rules',()=>{
  const check={check:'target',ruleId:'STYLE-A11Y-009',target:'#review',status:'fail',observed:{height:24},fix:'Use 40px <img src=x onerror=alert(1)>'};
  const previous={schemaVersion:1,status:'fail',artifactSha256:'a'.repeat(64),specSha256:'b'.repeat(64),projectConfigurationSha256:'c'.repeat(64),checks:[check],limitations:['Configured targets only.']};
  const report={...previous,status:'pass',artifactSha256:'d'.repeat(64),checks:[{...check,status:'pass',observed:{height:44}}]};
  const html=formatReport({report},{'#review':'index.html'},'html',{previous});
  assert.match(html,/<html lang="en">/);
  assert.match(html,/Content-Security-Policy/);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.ok(!html.includes('<img src=x'));
  assert.match(html,/1 finding resolved/);
  assert.match(formatReport({report},{},'html',{previous:{...previous,specSha256:'e'.repeat(64)}}),/Comparison unavailable/);
  assert.match(formatReport({report},{},'html',{previous:{...previous,checks:[]}}),/Comparison unavailable/);
});

test('a constitution pin binds generated tokens, all canonical documents and report identity',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'style-pin-'));
  try{
    const source=join(temp,'team'); await cp(join(root,'spec'),join(source,'spec'),{recursive:true});
    const projectRoot=join(temp,'project'); await cp(join(root,'examples/profile'),projectRoot,{recursive:true});
    const target=join(projectRoot,'constitution.json');
    const exported=run(['constitution','pin',source,target]); assert.equal(exported.status,0,exported.stderr);
    const pin=JSON.parse(exported.stdout);
    const configPath=join(projectRoot,'project.json'); const config=JSON.parse(await readFile(configPath,'utf8'));
    config.constitution={path:'constitution.json',sha256:pin.sha256}; await writeFile(configPath,JSON.stringify(config));
    const snapshot=await snapshotProject(await loadProject(configPath));
    assert.equal(snapshot.contract.constitution.sha256,pin.sha256);
    assert.equal(snapshot.contract.constitution.version,'0.8.0');
    assert.match(snapshot.css,/--size-control-md/);
    const fresh=join(temp,'fresh');await cp(join(root,'examples/profile'),fresh,{recursive:true});await rm(join(fresh,'project.json'));
    await cp(target,join(fresh,'constitution.json'));
    const initialized=run(['init',fresh,'--files','index.html','--trigger','#review','--dialog','#review-dialog','--close','#back','--name','Confirm display name','--constitution','constitution.json','--yes']);
    assert.equal(initialized.status,0,initialized.stderr);
    assert.deepEqual((await loadProject(join(fresh,'project.json'))).config.constitution,{path:'constitution.json',sha256:pin.sha256});
    const content=JSON.parse(await readFile(target,'utf8'));content.files['manifest.json'].version='0.6.1';await writeFile(target,JSON.stringify(content));
    await assert.rejects(snapshotProject(await loadProject(configPath)),/pin|hash|changed/i);
  }finally{await rm(temp,{recursive:true,force:true});}
});
