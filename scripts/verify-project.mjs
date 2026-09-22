/* global document, getComputedStyle */
import { setTimeout as delay } from 'node:timers/promises';
import { collectUiObservations } from './browser-journey.mjs';
import { evaluateObservations,createRepairPacket } from '../packages/browser-verification/src/index.mjs';
import { readProductState } from './product-observations.mjs';
import { appendProductChecks } from '../packages/browser-verification/src/product-checks.mjs';

export async function setInput(tab,selector,value) {
  const input=tab.playwright.locator(selector);
  if(value==='') {await input.press('ControlOrMeta+A');await input.press('Backspace');}
  else await input.fill(value);
  const actual=await tab.playwright.evaluate(selector=>document.querySelector(selector)?.value,selector);
  if(actual!==value) throw new Error('Browser input setup failed; no product finding may be inferred');
}

export async function verifyProject(tab,origin) {
  const base=new URL(origin);
  if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||base.username||base.password||base.pathname!=='/'||base.search||base.hash) throw new Error('Only a loopback project origin is allowed');
  const metadata=async()=>{const r=await fetch(`${base.origin}/_verification`);if(!r.ok)throw new Error('Project unavailable');return r.json();};
  const before=await metadata();const config=before.config; const extra={};
  if(await tab.url()===base.href) await tab.reload(); else await tab.goto(base.href);
  await tab.playwright.waitForLoadState({state:'load'});
  await tab.playwright.domSnapshot();
  if(config.form) {
    const f=config.form;
    if(await tab.playwright.locator(f.input).count()===1 && await tab.playwright.locator(f.submit).count()===1) {
      await setInput(tab,f.input,f.invalidValue);await tab.playwright.locator(f.submit).click();await tab.playwright.domSnapshot();
      extra.form=(await tab.playwright.evaluate(readProductState,{form:f})).form;
      if(await tab.playwright.locator(config.journey.dialog).isVisible()) await tab.playwright.locator(config.journey.close).click();
      await setInput(tab,f.input,f.validValue);
    } else extra.form={selector:f.input,found:false};
  }
  extra.states=(await tab.playwright.evaluate(readProductState,{states:config.states??[]})).states;
  extra.layout=await tab.playwright.evaluate(()=>({viewportWidth:document.documentElement.clientWidth,contentWidth:document.documentElement.scrollWidth}));
  const observations=await collectUiObservations(tab,config.journey);
  extra.closePaths=[];
  for(const close of config.closePaths??[]) {
    if(await tab.playwright.locator(config.journey.trigger).count()!==1) {extra.closePaths.push({selector:close});break;}
    await tab.playwright.locator(config.journey.trigger).press('Enter');await tab.playwright.domSnapshot();
    if(!await tab.playwright.locator(config.journey.dialog).isVisible()||await tab.playwright.locator(close).count()!==1) {extra.closePaths.push({selector:close});break;}
    await tab.playwright.locator(close).click();await tab.playwright.domSnapshot();
    const samples=[];for(let i=0;i<12;i++){await delay(100);samples.push(await tab.playwright.evaluate(id=>document.activeElement?.id===id,config.journey.trigger.slice(1)));}
    const closed=!await tab.playwright.locator(config.journey.dialog).isVisible();
    extra.closePaths.push({selector:close,closed,returnFocus:samples.every(Boolean)});
    if(!closed) break;
  }
  const after=await metadata();
  if(before.artifactSha256!==after.artifactSha256||before.contract.specSha256!==after.contract.specSha256) throw new Error('Project changed during verification');
  const report=appendProductChecks(evaluateObservations(before.contract,observations,{artifactSha256:before.artifactSha256}),extra);
  const repair=createRepairPacket({report,expectedSpecSha256:before.contract.specSha256,expectedArtifactSha256:before.artifactSha256,targetPaths:config.targetPaths});
  return {report,repair,observations,extra};
}
