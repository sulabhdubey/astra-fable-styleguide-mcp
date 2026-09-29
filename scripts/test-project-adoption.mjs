/* global window, document -- Used only inside Playwright page.evaluate callbacks. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';
import {runCheck,formatReport} from './standalone-check.mjs';
import {loadProject,applyRepair,undoRepair} from './project-workflow.mjs';
import {pinConstitution} from './constitution.mjs';

const root=resolve(import.meta.dirname,'..');
const evidence=await mkdtemp(join(process.argv[2]??tmpdir(),'style-adoption-'));
const projectRoot=join(evidence,'project');await mkdir(projectRoot);
const source=await readFile(join(root,'examples/profile/index.html'),'utf8');
await writeFile(join(projectRoot,'index.html'),source);
const setup=spawnSync(process.execPath,[resolve(root,'packages/cli/dist/stylecon.mjs'),'init',projectRoot,'--files','index.html','--trigger','#review','--dialog','#review-dialog','--close','#back','--name','Confirm display name','--input','#display-name','--submit','#review','--invalid-value','','--valid-value','Studio member','--yes'],{encoding:'utf8'});
assert.equal(setup.status,0,setup.stderr);
const configPath=join(projectRoot,'project.json');
const knownGood=await runCheck(configPath);assert.equal(knownGood.summary.status,'pass');
const before='#review{min-height:var(--size-control-md);padding:var(--space-2) var(--space-4)}';
const broken='#review{height:24px;min-height:24px;padding:0 var(--space-4)}';
assert.ok(source.includes(before));await writeFile(join(projectRoot,'index.html'),source.replace(before,()=>broken));
const failed=await runCheck(configPath);assert.equal(failed.summary.status,'fail');assert.equal(failed.summary.findings.filter(f=>f.status==='fail').length,1);
await writeFile(join(evidence,'before.json'),JSON.stringify(failed.result,null,2));
const project=await loadProject(configPath);
const repaired=await applyRepair(project,failed.result.repair,{path:'index.html',before:broken,after:before},{receiptDirectory:evidence});
const passed=await runCheck(configPath);assert.equal(passed.summary.status,'pass');
await writeFile(join(evidence,'after.json'),JSON.stringify(passed.result,null,2));
const html=formatReport(passed.result,passed.targetPaths,'html',{previous:failed.result});assert.match(html,/1 finding resolved/);
const reportPath=join(evidence,'report.html');await writeFile(reportPath,html);
await assert.rejects(applyRepair(project,failed.result.repair,{path:'index.html',before,after:broken},{receiptDirectory:evidence}),/Stale/);
await undoRepair(project,repaired.receiptPath,{receiptDirectory:evidence});assert.equal(await readFile(join(projectRoot,'index.html'),'utf8'),source.replace(before,()=>broken));
await writeFile(join(projectRoot,'index.html'),source);

const team=join(evidence,'team');await cp(join(root,'spec'),join(team,'spec'),{recursive:true});
const buttonPath=join(team,'spec/components/button.json');const button=JSON.parse(await readFile(buttonPath,'utf8'));button.accessibility.minimumTarget='48px';await writeFile(buttonPath,JSON.stringify(button));
const pinned=await pinConstitution(team,join(projectRoot,'constitution.json'));
const config=JSON.parse(await readFile(configPath,'utf8'));config.constitution={path:'constitution.json',sha256:pinned.sha256};await writeFile(configPath,JSON.stringify(config));
const strict=await runCheck(configPath);assert.ok(strict.summary.findings.some(f=>f.check==='target'&&f.observed.minimum===48&&f.status==='fail'));
assert.notEqual(strict.result.report.specSha256,knownGood.result.report.specSha256);
await writeFile(join(evidence,'strict.json'),JSON.stringify(strict.result,null,2));
assert.match(formatReport(strict.result,strict.targetPaths,'html',{previous:passed.result}),/Comparison unavailable/);
// Changing the canonical token changes generated CSS and the rendered measurements after explicit repinning.
// Update the owning canonical domain document, preserving all other domain files.
const {readdir}=await import('node:fs/promises');
for(const name of await readdir(join(team,'spec/tokens'))) {
  const path=join(team,'spec/tokens',name);const domain=JSON.parse(await readFile(path,'utf8'));
  if(domain.size?.control?.md){domain.size.control.md.$value='48px';await writeFile(path,JSON.stringify(domain));}
}
await rm(join(projectRoot,'constitution.json'));
const changed=await pinConstitution(team,join(projectRoot,'constitution.json'));
await assert.rejects(runCheck(configPath),/pin changed|Project unavailable/);
config.constitution.sha256=changed.sha256;await writeFile(configPath,JSON.stringify(config));
const enlarged=await runCheck(configPath);
assert.equal(enlarged.result.report.checks.find(c=>c.check==='target'&&c.target==='#review').status,'pass');
assert.equal(enlarged.result.report.checks.find(c=>c.check==='target'&&c.target==='#back').status,'fail');
// The checker must retain a literal 40px defect even when another button uses the new token.
await applyRepair(await loadProject(configPath),enlarged.result.repair,{path:'index.html',before:'button{min-height:40px;',after:'button{min-height:var(--size-control-md);'},{receiptDirectory:evidence});
const teamPassed=await runCheck(configPath);assert.equal(teamPassed.summary.status,'pass');
assert.ok(teamPassed.result.report.checks.filter(c=>c.check==='target').every(c=>c.observed.height>=48));
await writeFile(join(evidence,'team.json'),JSON.stringify(teamPassed.result,null,2));

delete config.constitution;await writeFile(configPath,JSON.stringify(config));
await writeFile(join(projectRoot,'index.html'),source.replace('<p id="name-preview">','<details><p>Additional information</p></details><p id="name-preview">'));
const unsupported=await runCheck(configPath);assert.equal(unsupported.summary.status,'not_checked');assert.equal(unsupported.summary.exitCode,2);
assert.ok(unsupported.result.report.checks.some(check=>check.status==='unsupported'));
await writeFile(join(evidence,'unsupported.json'),JSON.stringify(unsupported.result,null,2));
await writeFile(join(projectRoot,'index.html'),source.replace('</script>','throw new Error("synthetic runtime fault");</script>'));
await assert.rejects(runCheck(configPath),/Incomplete verification/);

const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(['warning','error'].includes(message.type()))errors.push(message.text());});
  await page.goto(pathToFileURL(reportPath).href);assert.equal(await page.title(),'Style Constitution — verification report');
  assert.match(await page.locator('body').innerText(),/1 finding resolved/);
  const summary=page.locator('#results details:not([open]) summary').first();await summary.click();
  assert.equal(await page.locator('details[open]').count(),1);
  for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844]]) {
    await page.setViewportSize({width,height});await page.evaluate(()=>window.scrollTo(0,0));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await page.screenshot({path:join(evidence,`report-${name}.png`),fullPage:true});
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();}
console.log(JSON.stringify({passed:true,privateEvidence:evidence,cases:['guided init','known-good','broken target','repair and recheck','stale repair rejected','undo','48px constitution rejects 40px UI','generated custom CSS changes actual target sizes','changed pin rejected','unsupported remains incomplete','runtime errors remain incomplete','desktop/mobile HTML and disclosure interaction']}));
