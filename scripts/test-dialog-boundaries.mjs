import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { collectUiObservations } from './browser-journey.mjs';
import { readFile } from 'node:fs/promises';
import { createContract, evaluateObservations } from '../packages/browser-verification/src/index.mjs';

const contract = createContract(Object.fromEntries(await Promise.all([
  ['button', 'spec/components/button.json'], ['dialog', 'spec/components/dialog.json'], ['rules', 'spec/accessibility/rules.json'],
].map(async ([key, path]) => [key, JSON.parse(await readFile(path, 'utf8'))]))));

const browser = await chromium.launch({ headless: true });
try {
  for (const [name, content, setup, risk] of [
    ['native', '', '', null],
    ['iframe', '<iframe srcdoc="<button>Inner</button>"></iframe>', '', 'embedded-content'],
    ['object', '<object tabindex="0"></object>', '', 'embedded-content'],
    ['embed', '<embed tabindex="0">', '', 'embedded-content'],
    ['details', '<details><p>Details without an explicit summary</p></details>', '', 'implicit-summary'],
    ['portal', '', 'const portal=document.createElement("button");portal.dataset.a11yDialogIgnoreFocusTrap="";portal.textContent="Portal";document.body.append(portal);', 'focus-trap-exception'],
    ['autofocus', '<input id="initial" autofocus>', '', null],
    ['container-focus', '', 'modal.tabIndex=-1;modal.focus();', null],
    ['explicit-summary', '<details><summary>More</summary><p>Details</p></details>', '', null],
    ['shadow', '<div id="host"></div>', 'host.attachShadow({mode:"open"}).innerHTML="<button>Shadow</button>";', 'shadow-root'],
    ['popover', '<div id="pop" popover><button>Inner</button></div>', 'pop.showPopover();', 'nested-overlay'],
  ]) {
    const page = await browser.newPage();
    await page.setContent(`<button id="open">Open</button><dialog id="modal" aria-labelledby="title"><h2 id="title">Review</h2><button id="close">Close</button>${content}</dialog><script>document.querySelector('#open').onclick=()=>{modal.showModal();${setup}};document.querySelector('#close').onclick=()=>modal.close();</script>`);
    const tab = { playwright: page, pressKey: (_target, key) => page.keyboard.press(key.replace('shift+', 'Shift+')), getAXState: async () => {} };
    const observed = await collectUiObservations(tab, { buttons: [], dialogButtons: [], trigger: '#open', dialog: '#modal', name: 'Review', close: '#close' });
    assert.ok(Array.isArray(observed.dialog.focusScopeRisks), name);
    if (risk) assert.ok(observed.dialog.focusScopeRisks.includes(risk), name);
    else { assert.deepEqual(observed.dialog.focusScopeRisks, []); assert.equal(observed.dialog.escapeClosed, true); assert.equal(observed.dialog.returnFocus, true, name); }
    const checks = evaluateObservations(contract, observed).checks;
    if (risk) assert.equal(checks.find(c => c.check === 'containment').status, 'unsupported', name);
    else assert.ok(['pass', 'fail'].includes(checks.find(c => c.check === 'containment').status), name);
    assert.equal(checks.find(c => c.check === 'escape').status, risk ? 'unsupported' : 'pass', name);
    if (name === 'popover') assert.ok(observed.dialog.escapeScopeRisks.includes('nested-overlay'));
    if (name === 'autofocus') assert.equal(observed.dialog.initialFocusInside, true);
    await page.close();
  }
  console.log('Dialog boundary browser checks passed: native, iframe, object, embed, implicit summary, focus-trap exception, autofocus, shadow root, open popover.');
} finally { await browser.close(); }
