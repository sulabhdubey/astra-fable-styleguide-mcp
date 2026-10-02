/* global document */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';

const repository=fileURLToPath(new URL('../',import.meta.url));
const {startStudio}=await import(process.argv[3]?pathToFileURL(resolve(process.argv[3])).href:'./studio.mjs');
const build=spawn(process.execPath,[resolve(repository,'node_modules/vite/bin/vite.js'),'build',resolve(repository,'examples/running-react')],{cwd:repository,stdio:'pipe',windowsHide:true});
let buildError='';build.stderr.on('data',chunk=>{buildError+=chunk;});
assert.equal((await once(build,'exit'))[0],0,buildError);
const root=await mkdtemp(join(tmpdir(),'stylecon-guided-vite-')),workspace=join(root,'workspace'),evidence=join(root,'evidence');
await mkdir(workspace);await mkdir(evidence);
for(const path of ['src','dist','package.json','index.html'])await cp(resolve(repository,'examples/running-react',path),join(workspace,path),{recursive:true});
const files=new Map();
async function collect(directory,prefix=''){
  const {readdir}=await import('node:fs/promises');
  for(const entry of await readdir(directory,{withFileTypes:true}))if(entry.isDirectory())await collect(join(directory,entry.name),prefix+entry.name+'/');else files.set('/'+prefix+entry.name,await readFile(join(directory,entry.name)));
}
await collect(join(workspace,'dist'));
const server=createServer((req,res)=>{const path=req.url==='/'?'/index.html':req.url;const bytes=files.get(path);res.writeHead(bytes?200:404,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)]??'application/octet-stream'});res.end(bytes??'not found');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const studio=await startStudio({workspace,evidenceDirectory:evidence}),browser=await chromium.launch({headless:true});
const screenshots=process.argv[2]?resolve(process.argv[2]):evidence;await mkdir(screenshots,{recursive:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.setDefaultTimeout(12000);
page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error'&&!/status of 400/.test(msg.text()))errors.push(msg.text());});
const message=text=>page.getByRole('status').filter({hasText:text}).waitFor({timeout:30000});
let releaseRequest;
try{
  await page.goto(studio.url);await message('local projects found');
  await page.getByLabel('Project',{exact:true}).selectOption('.');
  await page.getByRole('combobox',{name:'Project type',exact:true}).selectOption('vite');
  for(const [name,value]of Object.entries({url:`http://127.0.0.1:${server.address().port}/`,sourcePath:'src/main.jsx',trigger:'#open',dialog:'#dialog',close:'#close',name:'Review',measurement:'#title'}))await page.locator(`#vite-setup input[name="${name}"]`).fill(value);
  await page.getByRole('button',{name:'Validate & review setup',exact:true}).click();await message('Review the resolved rules');
  assert.match(await page.locator('#setup-rules').textContent(),/24px/);
  assert.match(await page.locator('#setup-review').textContent(),/Browser targets are not yet verified/);
  await assert.rejects(readFile(join(workspace,'project.json')),{code:'ENOENT'});
  await page.screenshot({path:join(screenshots,'guided-setup-desktop.png'),fullPage:true});
  // A user changing the form must lose the earlier approval affordance.
  await page.locator('#vite-setup input[name="name"]').fill('Changed');assert.equal(await page.locator('#setup-review').isHidden(),true);
  await page.locator('#vite-setup input[name="name"]').fill('Review');
  await page.getByRole('button',{name:'Validate & review setup',exact:true}).click();await message('Review the resolved rules');
  await page.getByRole('button',{name:'Save reviewed configuration',exact:true}).click();await message('Running application selected');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'message','a completed action hidden by navigation needs a visible focus destination');
  assert.match(await page.locator('#project option:checked').textContent(),/configured/);
  let reached;
  const requestReached=new Promise(resolve=>{reached=resolve;}),hold=new Promise(resolve=>{releaseRequest=resolve;});
  await page.route('**/api',async route=>{if(route.request().postDataJSON()?.action==='check'){reached();await hold;}await route.continue();});
  await page.getByRole('button',{name:'Run checks',exact:true}).click();await requestReached;
  assert.equal(await page.getByLabel('Project',{exact:true}).isDisabled(),true,'project scope must stay locked while a check is running');
  assert.equal(await page.getByRole('button',{name:'Refresh projects',exact:true}).isDisabled(),true);
  releaseRequest();await message('Configured checks passed');await page.unroute('**/api');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'run','completion should retain the initiating keyboard focus');
  assert.equal(await page.locator('#result-status').textContent(),'pass');
  assert.match(await page.locator('#coverage').textContent(),/Journey viewport: 1280px/);
  assert.match(await page.locator('#coverage').textContent(),/Measurement viewports: 390px, 1280px/);
  assert.match(await page.locator('#coverage').textContent(),/remain untested/);
  const configPath=join(workspace,'project.json'),config=JSON.parse(await readFile(configPath,'utf8'));
  await writeFile(configPath,JSON.stringify({...config,url:'https://example.invalid/'}));
  await page.getByRole('button',{name:'Run checks',exact:true}).click();await message('Only an explicit loopback');
  assert.equal(await page.locator('#results').isHidden(),true,'failed recheck must not leave the old pass displayed');
  assert.equal(await page.locator('#correction').isHidden(),true);
  assert.equal(await page.getByLabel('Project',{exact:true}).isEnabled(),true,'controls must unlock after failure');
  config.measurements[0].selector='#absent';
  await writeFile(configPath,JSON.stringify(config));
  await page.getByRole('button',{name:'Run checks',exact:true}).click();await message('Review highlighted findings');
  assert.equal(await page.locator('#result-status').textContent(),'not_checked');
  assert.match(await page.locator('#coverage-reasons').textContent(),/missing or hidden/);
  await page.screenshot({path:join(screenshots,'coverage-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
  await page.screenshot({path:join(screenshots,'coverage-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  await page.getByRole('button',{name:'Refresh projects',exact:true}).click();await message('local projects found');
  assert.equal(await page.getByRole('button',{name:'Run checks',exact:true}).isDisabled(),true);
  assert.equal(await page.locator('#results').isHidden(),true);
  const receipt={passed:true,runtime:process.argv[3]?'packaged':'source',cases:['guided configuration of real Vite build','resolved canonical rules','no write before review','form change invalidates preview','save and real browser pass','scope controls locked in flight','failed recheck clears old result and unlocks controls','keyboard focus retained','journey/measurement scope','missing target remains incomplete','mobile overflow','refresh clears old project state','no browser errors']};
  await writeFile(join(screenshots,'guided-setup-qa.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}catch(error){console.error(await page.locator('body').ariaSnapshot());throw error;}
finally{releaseRequest?.();await browser.close();await studio.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(process.argv[2])await rm(root,{recursive:true,force:true});}
