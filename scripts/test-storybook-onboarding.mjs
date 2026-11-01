/* global document */
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir,copyFile,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

// The installed CLI alone supplies the project, harness, Studio and browser runtime.
// No repository fixture or linked dependencies are used by this rehearsal.
const command=resolve(process.argv[2]??'packages/cli/dist/stylecon.mjs');
const output=process.argv[3]?resolve(process.argv[3]):null;
const temporary=await mkdtemp(join(tmpdir(),'stylecon-starter-rehearsal-'));
const npm=process.platform==='win32'?resolve(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'):null;
const env={...process.env};delete env.NODE_PATH;delete env.NODE_OPTIONS;
async function run(binary,args,cwd=temporary,expected=0){
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{cwd,env,stdio:['ignore','pipe','pipe']});let out='',err='';
    const timer=setTimeout(()=>child.kill(),180000);
    child.stdout.on('data',bytes=>out+=bytes);child.stderr.on('data',bytes=>err+=bytes);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);try{assert.equal(code,expected,err||out);resolve(out);}catch(error){reject(error);}});
  });
}
const cli=(args,expected=0)=>run(process.execPath,[command,...args],temporary,expected);
const npmRun=(args,cwd)=>run(npm?process.execPath:'npm',npm?[npm,...args]:args,cwd);
let preview,studio,browser;
try{
  const destination=join(temporary,'trial');
  const created=JSON.parse(await cli(['demo',destination,'--storybook']));
  assert.equal(created.project,join(destination,'project'));
  assert.match(await readFile(join(destination,'.gitignore'),'utf8'),/PILOT_FEEDBACK\.md/);
  assert.match(await readFile(join(created.project,'.gitignore'),'utf8'),/\.env/);
  await cli(['demo',destination,'--storybook'],2);
  await cli(['demo','relative','--storybook'],2);
  const missing=JSON.parse(await cli(['doctor',created.project],2));
  assert.ok(missing.checks.some(check=>check.id==='dependencies'&&check.status==='fail'));
  assert.ok(missing.checks.some(check=>check.id==='build'&&check.status==='fail'));
  await npmRun(['ci','--ignore-scripts','--no-audit','--no-fund'],created.project);
  console.log('Starter installed from its own lockfile without lifecycle scripts.');
  assert.equal((await lstat(join(created.project,'node_modules'))).isSymbolicLink(),false);
  const projectRequire=createRequire(join(created.project,'package.json'));
  for(const name of ['react','react-dom','storybook','@storybook/react','vite'])assert.ok(projectRequire.resolve(`${name}/package.json`).startsWith(join(created.project,'node_modules')));
  await npmRun(['run','build'],created.project);
  const configPath=join(created.project,'project.json'),config=JSON.parse(await readFile(configPath,'utf8'));
  // Port 0 asks Vite for a free loopback port; record it in the checked config.
  const vite=join(dirname(projectRequire.resolve('vite/package.json')),'bin/vite.js');
  preview=spawn(process.execPath,[vite,'preview','--host','127.0.0.1','--port','0','--strictPort'],{cwd:created.project,env:{...env,NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});
  const url=await new Promise((resolve,reject)=>{
    let text='';const timer=setTimeout(()=>reject(new Error('Starter preview did not start')),15000);
    preview.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/http:\/\/127\.0\.0\.1:\d+\//);if(match){clearTimeout(timer);resolve(match[0]);}});
    preview.once('error',error=>{clearTimeout(timer);reject(error);});preview.once('exit',()=>{clearTimeout(timer);reject(new Error('Starter preview exited before readiness'));});
  });
  config.url=url;await writeFile(configPath,JSON.stringify(config,null,2)+'\n');
  const ready=JSON.parse(await cli(['doctor',created.project]));assert.equal(ready.ready,true);assert.equal(ready.scope,'readiness only; no story compliance result');
  const states=[];
  for(const [name,status,exit] of [['button','pass',0],['input','pass',0],['card','pass',0],['dialog','pass',0],['broken','fail',1],['skipped','not_checked',2],['failed','not_checked',2],['unfinished','not_checked',2]]){
    const checked=JSON.parse(await cli(['check',created.project,'--story','constitution-components--'+name,'--rules','typography,spacing','--format','json'],exit));
    assert.equal(checked.report.status,status);states.push({story:name,status,exitCode:exit});
    console.log(`Starter ${name}: ${status} (${exit})`);
  }
  const {startStudio}=await import(pathToFileURL(resolve(command,'../runtime/scripts/studio.mjs')).href);
  const {chromium}=createRequire(command)('playwright');browser=await chromium.launch({headless:true});
  studio=await startStudio({workspace:created.project,evidenceDirectory:created.evidence});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const select=async()=>{await page.goto('about:blank');await page.goto(studio.url);await page.getByRole('status').filter({hasText:'local projects found'}).waitFor();await page.getByLabel('Project',{exact:true}).selectOption('.');await page.getByRole('status').filter({hasText:'Storybook project ready'}).waitFor();};
  await select();await page.getByLabel('Story',{exact:true}).selectOption('constitution-components--broken');
  await page.getByRole('button',{name:'Run checks',exact:true}).click();await page.getByRole('status').filter({hasText:'Review highlighted findings'}).waitFor({timeout:30000});
  assert.equal(await page.locator('#result-status').textContent(),'fail');assert.equal(await page.locator('#story-images img').count(),2);
  await page.getByRole('checkbox',{name:/Include STYLE-MEASURE-SPACING/}).first().check();await page.getByRole('button',{name:'Prepare selected findings'}).click();await page.getByRole('status').filter({hasText:'Brief prepared'}).waitFor();
  assert.match(await page.locator('#brief-text').inputValue(),/paddingTop/);assert.equal(await page.locator('#correction').isVisible(),false);
  if(output){await mkdir(output,{recursive:true});await page.screenshot({path:join(output,'starter-findings.png'),fullPage:true});}
  const component=join(created.project,'src/Components.stories.mjs'),before=await readFile(component,'utf8');
  assert.ok(before.includes("fontSize:'12px',paddingTop:'3px'"));
  await writeFile(component,before.replace("fontSize:'12px',paddingTop:'3px'","fontSize:'16px',paddingTop:'16px'"));
  await npmRun(['run','build'],created.project);
  await page.getByRole('button',{name:'Run checks',exact:true}).click();await page.getByRole('status').filter({hasText:'Configured checks passed'}).waitFor({timeout:30000});assert.equal(await page.locator('#result-status').textContent(),'pass');
  // Studio intentionally removes the secret fragment; reload requires the full CLI link.
  await page.reload();await page.getByRole('status').filter({hasText:'Open the complete local Studio link'}).waitFor();await select();assert.equal(await page.locator('#story-id').inputValue(),'constitution-components--broken');
  await studio.close();studio=await startStudio({workspace:created.project,evidenceDirectory:created.evidence});await select();
  assert.equal(await page.locator('#story-id').inputValue(),'constitution-components--broken');
  await page.getByText('Previous checks & comparison',{exact:true}).click();await page.getByRole('button',{name:'Open selected later run'}).click();await page.getByRole('status').filter({hasText:'Historical evidence opened'}).waitFor();assert.equal(await page.locator('#story-images img').count(),2);assert.equal(await page.locator('#agent-handoff').isVisible(),false);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
  if(output)await page.screenshot({path:join(output,'starter-history-mobile.png'),fullPage:true});assert.deepEqual(errors,[]);
  await browser.close();browser=null;await studio.close();studio=null;
  const exited=once(preview,'exit');preview.kill();await exited;preview=null;
  const stopped=JSON.parse(await cli(['doctor',created.project],2));assert.ok(stopped.checks.some(check=>check.id==='preview'&&check.status==='fail'));
  const receipt={schemaVersion:1,operator:'agent rehearsal, not independent developer acceptance',starterFromInstalledCli:true,repositorySourcesBorrowed:false,repositoryDependencyLinks:false,lifecycleScripts:false,readinessBeforeSetup:'incomplete',readinessAfterSetup:'ready',readinessAfterPreviewStops:'incomplete',states,manualCorrectionRecheck:'pass',studio:{highlightedFindings:true,brief:true,reloadAfterReauthentication:true,restartHistory:true,mobile:true},feedback:'manual opt-in; no transmission',published:false};
  if(output){await writeFile(join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});await copyFile(created.feedback,join(output,'PILOT_FEEDBACK.md'));}
  console.log(JSON.stringify(receipt));
}finally{
  await browser?.close();await studio?.close();if(preview&&preview.exitCode===null){const exited=once(preview,'exit');preview.kill();await exited;}
  // temporary is the exact unique directory this process created, never a caller path.
  await rm(temporary,{recursive:true,force:true});
}
