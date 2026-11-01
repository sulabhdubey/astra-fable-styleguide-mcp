import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,cp,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {prepareStorybookDemo,doctor} from '../scripts/storybook-onboarding.mjs';
import {copyStarterFiles} from '../packages/cli/storybook/assets.mjs';
import {fileURLToPath} from 'node:url';

async function fixture(t){const root=await mkdtemp(join(tmpdir(),'stylecon-onboard-'));t.after(()=>rm(root,{recursive:true,force:true}));return {root,...await prepareStorybookDemo(join(root,'trial'))};}
const launched=async()=>({close:async()=>{}});
async function readyFiles(f){
  const config=JSON.parse(await readFile(join(f.project,'project.json'),'utf8'));
  await mkdir(join(f.project,'dist'));await writeFile(join(f.project,'dist/index.html'),'<html>controlled preview</html>');
  for(const [name,version] of Object.entries({'react':'19.3.0','react-dom':'19.3.0','storybook':'10.6.3','vite':'8.3.3','@storybook/react':'10.6.3'})){
    const path=join(f.project,'node_modules',name);await mkdir(path,{recursive:true});await writeFile(join(path,'package.json'),JSON.stringify({name,version}));
  }
  return config;
}
test('starter is isolated, version pinned, self-contained and never overwrites',async t=>{
  const f=await fixture(t);const main=await readFile(join(f.project,'src/main.mjs'),'utf8');
  assert.match(main,/\.\/harness.mjs/);assert.doesNotMatch(main,/\.\.\//);
  const pkg=JSON.parse(await readFile(join(f.project,'package.json'),'utf8'));assert.equal(pkg.dependencies.react,'19.3.0');
  const config=JSON.parse(await readFile(join(f.project,'project.json'),'utf8'));assert.ok(config.identityFiles.includes('package-lock.json'));
  const form=await readFile(join(f.root,'trial/PILOT_FEEDBACK.md'),'utf8');assert.match(form,/Nothing is sent automatically/);assert.match(form,/second/);assert.match(form,/Do not include/);
  await writeFile(join(f.project,'keep.txt'),'owner bytes');await assert.rejects(()=>prepareStorybookDemo(join(f.root,'trial')),/exist|EEXIST/i);
  assert.equal(await readFile(join(f.project,'keep.txt'),'utf8'),'owner bytes');await assert.rejects(()=>prepareStorybookDemo('relative-path'),/absolute/);
});
test('doctor distinguishes missing dependencies and build; browser errors disclose no raw paths',async t=>{
  const f=await fixture(t);const result=await doctor(f.project,{launch:async()=>{throw new Error('private C:/owner/SECRET');}});
  assert.equal(result.ready,false);assert.equal(result.exitCode,2);assert.ok(result.checks.some(c=>c.id==='dependencies'&&c.status==='fail'));
  assert.ok(result.checks.some(c=>c.id==='build'&&c.status==='fail'));assert.doesNotMatch(JSON.stringify(result),/SECRET|C:\/owner/);
});
test('doctor rejects installed-version mismatches and an unreachable preview',async t=>{
  const f=await fixture(t);await readyFiles(f);await writeFile(join(f.project,'node_modules/react/package.json'),JSON.stringify({version:'19.2.8'}));
  const result=await doctor(f.project,{launch:launched});assert.equal(result.ready,false);assert.ok(result.checks.some(c=>c.id==='dependencies'&&c.status==='fail'));
});
test('doctor checks real preview bytes without executing project code or following redirects',async t=>{
  const f=await fixture(t),config=await readyFiles(f);let mode='match';let requests=0;
  const server=createServer((req,res)=>{requests++;if(mode==='redirect'){res.writeHead(302,{location:'https://example.invalid/'});res.end();}else res.end(mode==='match'?'<html>controlled preview</html>':'different build');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  config.url=`http://127.0.0.1:${server.address().port}/`;await writeFile(join(f.project,'project.json'),JSON.stringify(config));
  const good=await doctor(f.project,{launch:launched});assert.equal(good.ready,true,JSON.stringify(good));assert.equal(good.exitCode,0);assert.equal(good.scope,'readiness only; no story compliance result');
  for(const change of ['wrong','redirect']){mode=change;const result=await doctor(f.project,{launch:launched});assert.equal(result.ready,false);assert.ok(result.checks.some(c=>c.id==='preview'&&c.status==='fail'));}
  const before=requests;config.url='https://example.invalid/';await writeFile(join(f.project,'project.json'),JSON.stringify(config));
  const invalid=await doctor(f.project,{launch:launched});assert.equal(invalid.ready,false);assert.equal(requests,before);
});
test('doctor reports connection failure and invalid configuration as incomplete readiness',async t=>{
  const f=await fixture(t),config=await readyFiles(f);config.url='http://127.0.0.1:1/';await writeFile(join(f.project,'project.json'),JSON.stringify(config));
  const result=await doctor(f.project,{launch:launched});assert.equal(result.ready,false);assert.ok(result.checks.some(c=>c.id==='preview'&&c.status==='fail'));
  await writeFile(join(f.project,'project.json'),'{');assert.equal((await doctor(f.project,{launch:launched})).ready,false);
});

test('starter prevents accidental Git inclusion of feedback, evidence, dependencies and local secrets',async t=>{
  const f=await fixture(t),cwd=join(f.root,'trial');
  assert.equal(spawnSync('git',['init','--quiet'],{cwd}).status,0);
  const privatePaths=['PILOT_FEEDBACK.md','evidence/result.json','project/node_modules/react/index.js','project/dist/index.html','project/.env.local'];
  const ignored=spawnSync('git',['check-ignore','--no-index',...privatePaths],{cwd,encoding:'utf8'});
  assert.equal(ignored.status,0);assert.deepEqual(ignored.stdout.trim().split(/\r?\n/),privatePaths);
  assert.equal(spawnSync('git',['check-ignore','--no-index','project/src/main.mjs'],{cwd}).status,1);
});

test('starter packaging copies only declared product assets, excluding private canaries and dependency trees',async t=>{
  const f=await fixture(t),source=join(f.root,'assets'),output=join(f.root,'package-assets');
  await cp(fileURLToPath(new URL('../packages/cli/storybook/starter/',import.meta.url)),source,{recursive:true});
  await writeFile(join(source,'project/.env.local'),'PRIVATE_CANARY=synthetic-not-a-secret');
  await mkdir(join(source,'project/node_modules'));await writeFile(join(source,'project/node_modules/private.txt'),'synthetic private bytes');
  await copyStarterFiles(source,output);
  assert.match(await readFile(join(output,'project/package.json'),'utf8'),/stylecon-storybook-starter/);
  await assert.rejects(()=>access(join(output,'project/.env.local')),{code:'ENOENT'});
  await assert.rejects(()=>access(join(output,'project/node_modules')),{code:'ENOENT'});
});
