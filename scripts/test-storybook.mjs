/* global document */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,mkdir,cp,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {runStorybookCheck} from './storybook-check.mjs';
import {assertCurrentReport} from './evidence-current.mjs';
import {startStudio} from './studio.mjs';
import {chromium} from 'playwright';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {build} from 'vite';
const fixture=fileURLToPath(new URL('../apps/storybook-fixture/',import.meta.url));
const cliIndex=process.argv.indexOf('--cli'),cli=cliIndex>=0?resolve(process.argv[cliIndex+1]):null;
const studioStart=cli?(await import(pathToFileURL(resolve(cli,'../runtime/scripts/studio.mjs')).href)).startStudio:startStudio;
const temporary=await mkdtemp(resolve(tmpdir(),'stylecon-story-proof-')),workspace=resolve(temporary,'workspace'),project=resolve(workspace,'stories'),evidence=resolve(temporary,'evidence');
await mkdir(project,{recursive:true});await mkdir(evidence);
for(const file of ['src','dist','project.json','package.json','vite.config.mjs','index.html'])await cp(resolve(fixture,file),resolve(project,file),{recursive:true});
await symlink(resolve(fixture,'node_modules'),resolve(project,'node_modules'),'junction');
await cp(fileURLToPath(new URL('../packages/cli/storybook/harness.mjs',import.meta.url)),resolve(project,'src/harness.mjs'));
const main=resolve(project,'src/main.mjs');await writeFile(main,(await readFile(main,'utf8')).replace('../../../packages/cli/storybook/harness.mjs','./harness.mjs'));
await build({root:project,configFile:resolve(project,'vite.config.mjs'),logLevel:'error'});
const configPath=resolve(project,'project.json');
const root=resolve(project,'dist');
let alteredResponse=false;
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1');if(url.pathname.includes('..'))throw new Error();const file=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root))throw new Error();res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');const bytes=await readFile(file);res.end(alteredResponse&&url.pathname==='/'?Buffer.concat([bytes,Buffer.from('<!-- changed response -->')]):bytes);}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(4193,'127.0.0.1',resolve));
try {
  if(!process.argv.includes('--studio-only'))for(const [name,status,exit] of [['button','pass',0],['input','pass',0],['card','pass',0],['dialog','pass',0],['broken','fail',1],['skipped','not_checked',2],['failed','not_checked',2],['unfinished','not_checked',2]]) {
    const checked=await runStorybookCheck(configPath,{selection:{storyId:'constitution-components--'+name,rules:['typography','spacing']}});
    console.log(name,checked.summary.status,checked.summary.checks,checked.summary.exitCode);
    assert.equal(checked.summary.status,status);assert.equal(checked.summary.exitCode,exit);
    if(status==='pass')assert.equal(checked.result.previews.length,2);
  }
  if(!process.argv.includes('--studio-only')) {
    alteredResponse=true;
    const changed=await runStorybookCheck(configPath);
    assert.equal(changed.summary.exitCode,2);
    assert.equal(changed.result.report.checks.find(check=>check.check==='story.resources').status,'not_checked');
    alteredResponse=false;
    console.log('Changed served bytes cannot pass despite matching rendered measurements.');
  }
  if(cli){
    const output=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,'check',configPath,'--story','constitution-components--broken','--rules','spacing','--format','json'],{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);child.on('error',reject);child.on('exit',code=>code===1?resolve(out):reject(new Error(err||out)));});
    const result=JSON.parse(output);assert.equal(result.report.status,'fail');assert.ok(result.report.checks.some(check=>check.check==='spacing.paddingTop'));assert.ok(!result.report.checks.some(check=>check.check==='typography.fontSize'));
  }
  let studio=await studioStart({workspace,evidenceDirectory:evidence});const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(studio.url);await page.getByRole('status').filter({hasText:'local projects found'}).waitFor();
    await page.getByLabel('Project',{exact:true}).selectOption('stories');await page.getByRole('status').filter({hasText:'Storybook project ready'}).waitFor();
    await page.getByLabel('Story',{exact:true}).selectOption('constitution-components--broken');
    await page.getByRole('button',{name:'Run checks',exact:true}).click();await page.getByRole('status').filter({hasText:'Review highlighted findings'}).waitFor({timeout:30000});
    assert.equal(await page.locator('#result-status').textContent(),'fail');assert.equal(await page.locator('#story-images img').count(),2);
    await page.getByRole('checkbox',{name:/Include STYLE-MEASURE-SPACING/}).first().check();
    await page.getByRole('button',{name:'Prepare selected findings'}).click();await page.getByRole('status').filter({hasText:'Brief prepared'}).waitFor();
    assert.match(await page.locator('#brief-text').inputValue(),/paddingTop/);
    assert.match(await page.locator('#brief-text').inputValue(),/constitution-components--broken/);
    assert.equal(await page.locator('#correction').isVisible(),false);
    await page.screenshot({path:resolve(evidence,'studio-story-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    await page.screenshot({path:resolve(evidence,'studio-story-mobile.png'),fullPage:true});
    const component=resolve(project,'src/Components.stories.mjs');
    await writeFile(component,(await readFile(component,'utf8')).replace("fontSize:'12px',paddingTop:'3px'","fontSize:'16px',paddingTop:'16px'"));
    await build({root:project,configFile:resolve(project,'vite.config.mjs'),logLevel:'error'});
    await page.getByRole('button',{name:'Run checks',exact:true}).click();await page.getByRole('status').filter({hasText:'Configured checks passed'}).waitFor({timeout:30000});
    assert.equal(await page.locator('#result-status').textContent(),'pass');
    await studio.close();studio=await studioStart({workspace,evidenceDirectory:evidence});await page.goto(studio.url);await page.getByRole('status').filter({hasText:'local projects found'}).waitFor();
    await page.getByLabel('Project',{exact:true}).selectOption('stories');await page.getByRole('status').filter({hasText:'Storybook project ready'}).waitFor();
    assert.equal(await page.locator('#story-id').inputValue(),'constitution-components--broken');
    await page.getByText('Previous checks & comparison',{exact:true}).click();
    await page.getByRole('button',{name:'Open selected later run'}).click();await page.getByRole('status').filter({hasText:'Historical evidence opened'}).waitFor();
    assert.equal(await page.locator('#story-images img').count(),2);assert.equal(await page.locator('#agent-handoff').isVisible(),false);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await studio.close();}
  const baseline=await runStorybookCheck(configPath);
  await assertCurrentReport(configPath,baseline.result.report);
  await writeFile(resolve(project,'src/changed.mjs'),'// competing source edit');
  await assert.rejects(()=>assertCurrentReport(configPath,baseline.result.report),/stale/);
  console.log('Studio selection, brief, screenshots, restart, narrow layout and stale-source rejection passed. Evidence:',evidence);
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
