import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGitEvidence,compareGitEvidence,renderPrSummary,captureGitEvidence} from '../scripts/ci-report.mjs';
import {loadRunningProject} from '../scripts/running-app.mjs';
import {pinConstitution} from '../scripts/constitution.mjs';
const hash='a'.repeat(64);
const report=checks=>({status:checks.some(c=>c.status==='fail')?'fail':checks.every(c=>c.status==='pass')?'pass':'not_checked',artifactSha256:hash,specSha256:hash,projectConfigurationSha256:hash,checks});
const check=(target,status)=>({ruleId:'STYLE-A11Y-009',check:'target',target,status,observed:{height:status==='pass'?40:24},fix:'Review minimum height'});
const evidence=(commit,checks)=>createGitEvidence({commit:commit.repeat(40),tree:'c'.repeat(40),projectPath:'example/project.json'}, {report:report(checks)});
test('PR evidence distinguishes newly failed, resolved and incomplete checks',()=>{
  const base=evidence('a',[check('#one','fail'),check('#two','pass'),check('#three','pass')]);
  const head=evidence('b',[check('#one','pass'),check('#two','fail'),check('#three','not_checked')]);
  const result=compareGitEvidence(base,head);
  assert.equal(result.newViolations.length,1);assert.equal(result.resolved.length,1);assert.equal(result.incomplete.length,1);assert.equal(result.exitCode,2);
  assert.match(renderPrSummary(result),/Incomplete/);assert.match(renderPrSummary(result),/bbbbbbbb/);
});
test('mismatched coverage, altered receipts and missing baseline cannot look clean',()=>{
  const base=evidence('a',[check('#one','pass')]),head=evidence('b',[check('#two','pass')]);
  assert.equal(compareGitEvidence(base,head).compatible,false);
  assert.equal(compareGitEvidence(null,head).exitCode,2);
  head.result.report.status='fail';assert.throws(()=>compareGitEvidence(base,head),/integrity/);
});
test('summaries render project-origin Markdown and HTML inert',()=>{
  const target='<img src=x> [click](https://bad.example) | @everyone';
  const result=compareGitEvidence(evidence('a',[check(target,'pass')]),evidence('b',[check(target,'fail')]));
  const text=renderPrSummary(result);assert.doesNotMatch(text,/<img|\[click\]\(|\| @everyone/);assert.match(text,/&lt;img/);
});

async function runningGitFixture() {
  const root=await mkdtemp(join(tmpdir(),'style-ci-evidence-'));await mkdir(join(root,'src'));await mkdir(join(root,'dist'));
  const app='export default function App(){}\n';
  const repository=fileURLToPath(new URL('../',import.meta.url));const pin=await pinConstitution(repository,join(root,'constitution.json'));
  const config={schemaVersion:2,integration:'vite-preview',url:'http://127.0.0.1:4173/',sourceDirectory:'src',buildDirectory:'dist',identityFiles:['package.json'],constitution:{path:'constitution.json',sha256:pin.sha256},journey:{buttons:['#open'],trigger:'#open',dialog:'#dialog',name:'Review',dialogButtons:['#close'],close:'#close'},targetPaths:{'#open':'src/App.jsx','#close':'src/App.jsx','#title':'src/App.jsx',dialog:'src/App.jsx',page:'src/App.jsx'},measurements:[{selector:'#title',target:'#title',typography:{fontSize:'typography.fontSize.500'}}]};
  await Promise.all([writeFile(join(root,'src','App.jsx'),app),writeFile(join(root,'dist','index.html'),'<!doctype html>\n'),writeFile(join(root,'package.json'),'{"name":"ci-fixture","private":true}\n'),writeFile(join(root,'project.json'),JSON.stringify(config))]);
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'});git('init');git('config','user.email','test@example.invalid');git('config','user.name','Style test');git('add','.');git('commit','-m','fixture');
  return {root,path:join(root,'project.json'),app};
}
async function runningResult(path) {
  const project=await loadRunningProject(path);return {result:{report:{status:'pass',artifactSha256:project.identity.before.sha256,specSha256:project.contract.specSha256,projectConfigurationSha256:project.configHash,runningApp:{identity:project.identity.before},checks:[{ruleId:'STYLE-A11Y-009',check:'target',target:'#open',status:'pass',observed:{height:40},expected:{minimum:40},fix:'Use the canonical target size.'}]}}};
}

test('schema v2 capture binds tracked source/build identity and refuses dirty or changed-commit evidence',async()=>{
  const fixture=await runningGitFixture();
  try {
    const captured=await captureGitEvidence(fixture.path,runningResult);assert.equal(captured.git.projectPath,'project.json');assert.equal(captured.result.report.runningApp.identity.scope,'SHA-256 of configured source, build and identity-file bytes');
    await writeFile(join(fixture.root,'src','App.jsx'),'changed\n');
    await assert.rejects(captureGitEvidence(fixture.path,runningResult),/clean, committed/i);
    await writeFile(join(fixture.root,'src','App.jsx'),fixture.app);
    await assert.rejects(captureGitEvidence(fixture.path,async path=>{const result=await runningResult(path);execFileSync('git',['-C',fixture.root,'commit','--allow-empty','-m','changed during capture']);return result;}),/changed during capture/i);
  } finally {await rm(fixture.root,{recursive:true,force:true});}
});

test('schema v2 capture requires an optional constitution pin to be tracked',async()=>{
  const fixture=await runningGitFixture();
  try {
    execFileSync('git',['-C',fixture.root,'rm','--cached','constitution.json']);
    await assert.rejects(captureGitEvidence(fixture.path,runningResult),/clean, committed/i);
  } finally {await rm(fixture.root,{recursive:true,force:true});}
});

test('spec mismatches and incomplete head evidence remain explicitly non-clean',()=>{
  const base=evidence('a',[check('#one','pass')]);const mismatch=createGitEvidence({commit:'b'.repeat(40),tree:'c'.repeat(40),projectPath:'example/project.json'},{report:{...report([check('#one','pass')]),specSha256:'b'.repeat(64)}});assert.equal(compareGitEvidence(base,mismatch).compatible,false);
  const incomplete=compareGitEvidence(base,evidence('b',[check('#one','not_checked')]));assert.equal(incomplete.exitCode,2);assert.match(renderPrSummary(incomplete),/Observed/);
});
