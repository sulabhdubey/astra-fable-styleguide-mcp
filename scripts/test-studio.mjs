/* global document */
import {mkdtemp,mkdir,readFile,cp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {prepareDemo} from './prepare-demo.mjs';
const {startStudio}=await import(process.argv[3]?pathToFileURL(resolve(process.argv[3])).href:'./studio.mjs');

const root=await mkdtemp(join(tmpdir(),'stylecon-studio-proof-'));
const workspace=join(root,'workspace'),evidence=join(root,'evidence');await mkdir(workspace);await mkdir(evidence);
const demo=await prepareDemo(join(workspace,'demo'));
const change=JSON.parse(await readFile(demo.change,'utf8'));
await mkdir(join(workspace,'unconfigured'));await cp(join(workspace,'demo/project/index.html'),join(workspace,'unconfigured/index.html'));
await mkdir(join(workspace,'rules'));await cp(fileURLToPath(new URL('../spec',import.meta.url)),join(workspace,'rules/spec'),{recursive:true});
const studio=await startStudio({workspace,evidenceDirectory:evidence});
const browser=await chromium.launch({headless:true});const errors=[];
const screenshots=process.argv[2]?resolve(process.argv[2]):evidence;
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
const message=text=>page.getByRole('status').filter({hasText:text}).waitFor({timeout:60000});
try {
  await page.goto(studio.url);await message('local projects found');assert.match(await page.title(),/Local Studio/);
  await page.getByLabel('Project',{exact:true}).selectOption('unconfigured');await message('Choose IDs');
  for(const [name,value]of [['trigger','#review'],['dialog','#review-dialog'],['close','#back'],['name','Confirm display name']])await page.locator(`#setup input[name="${name}"]`).fill(value);
  await page.getByRole('button',{name:'Create configuration',exact:true}).click();await message('Project ready');assert.equal(JSON.parse(await readFile(join(workspace,'unconfigured/project.json'),'utf8')).journey.trigger,'#review');
  await page.getByLabel('Project',{exact:true}).selectOption('demo/project');await message('Project ready');
  await page.getByRole('button',{name:'Run checks',exact:true}).click();await message('Review highlighted findings');
  assert.equal(await page.locator('#result-status').textContent(),'fail');assert.equal(await page.locator('tr[data-status="fail"]').count(),1);
  await page.locator('tr[data-status="fail"]').getByRole('button',{name:'Inspect'}).click();assert.match(await page.locator('#finding-json').textContent(),/observed/);
  await page.screenshot({path:join(screenshots,'studio-desktop.png'),fullPage:true});
  await page.getByLabel('Current text',{exact:true}).fill(change.before);await page.getByLabel('Replacement text',{exact:true}).fill(change.after);
  await page.getByRole('button',{name:'Preview correction',exact:true}).click();await message('Review the exact change');
  await page.getByRole('button',{name:'Apply this correction',exact:true}).click();await message('Correction applied and rechecked');assert.equal(await page.locator('#result-status').textContent(),'pass');
  await page.getByRole('button',{name:'Undo last correction',exact:true}).click();await message('Original source restored and rechecked');assert.equal(await page.locator('#result-status').textContent(),'fail');
  await page.getByRole('button',{name:'02 · Create rules',exact:true}).click();await page.getByLabel('Constitution repository, relative to workspace').fill('rules');await page.getByRole('button',{name:'Load canonical rules'}).click();await message('Canonical rules loaded');
  await page.getByLabel('Rule',{exact:true}).selectOption('tokens.space.4.$value');await page.getByLabel('New value',{exact:true}).fill('20px');await page.getByRole('button',{name:'Add to review',exact:true}).click();
  await page.getByRole('button',{name:'Validate & review candidate'}).click();await message('Candidate validated');
  await page.getByLabel('New export directory, relative to workspace').fill('team-rules');await page.getByRole('button',{name:'Approve this hash & export'}).click();await message('Approved constitution exported');
  const exported=JSON.parse(await readFile(join(workspace,'team-rules/spec/tokens/primitive.json'),'utf8'));assert.equal(exported.space['4'].$value,'20px');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(screenshots,'studio-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
  await page.keyboard.press('Tab');assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY');
  assert.deepEqual(errors,[]);
  const receipt={passed:true,cases:['render desktop/mobile','configured targets','real browser failure','finding details','exact preview','apply and real recheck','undo and real recheck','canonical authoring and approved export','no horizontal overflow','keyboard focus','no runtime console errors'],privateEvidence:evidence,screenshots};
  await writeFile(join(evidence,'studio-qa.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}catch(error){console.error('Studio visible state:',await page.locator('#message').textContent());console.error('Browser errors:',JSON.stringify(errors));throw error;}finally{await browser.close();await studio.close();}
