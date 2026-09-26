/* global document, getComputedStyle */
import { setTimeout as delay } from 'node:timers/promises';
// Adapter accepts the documented CUA tab interface. Evaluation is DOM-read-only.
export async function collectUiObservations(tab, config) {
  const focus = () => tab.playwright.evaluate(() => document.activeElement?.id ?? '');
  const measure = selector => tab.playwright.evaluate(selector => {
    const element = document.querySelector(selector);
    if (!element) return { selector, visible: false };
    const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
    let parent = element.parentElement; let adjacentColor = ''; let backgroundImage = 'none'; let occlusionRisk = +style.opacity < 1;
    while (parent) {
      const s = getComputedStyle(parent);
      if (s.backgroundImage !== 'none') backgroundImage = s.backgroundImage;
      if (s.overflow === 'hidden' || s.overflow === 'clip' || +s.opacity < 1) occlusionRisk = true;
      if (!adjacentColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)') adjacentColor = s.backgroundColor;
      parent = parent.parentElement;
    }
    return { selector, width: rect.width, height: rect.height, visible: rect.width > 0 && rect.height > 0 && style.visibility === 'visible' && +style.opacity > 0,
      focused: document.activeElement === element, focusVisible: element.matches(':focus-visible'), outlineWidth: +style.outlineWidth.replace('px', ''),
      outlineStyle: style.outlineStyle, outlineColor: style.outlineColor, boxShadow: style.boxShadow, adjacentColor, backgroundImage, occlusionRisk };
  }, selector);
  const collectButtons = async selectors => {
    const results = [];
    for (const selector of selectors) {
      if(await tab.playwright.locator(selector).count()!==1) {results.push({selector,visible:false});continue;}
      for (let step = 0; step < 30 && await focus() !== selector.slice(1); step++) await tab.pressKey(null, 'Tab');
      results.push(await measure(selector));
    }
    return results;
  };
  const buttons = await collectButtons(config.buttons);
  if(await tab.playwright.locator(config.trigger).count()!==1) return {buttons,dialog:{found:false}};
  await tab.playwright.locator(config.trigger).press('Enter');
  const state = await tab.playwright.evaluate(selector => {
    const d = document.querySelector(selector);
    if (!d) return { found: false };
    const rect = d.getBoundingClientRect();
    const titles = (d.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id));
    const visible = e => e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility === 'visible';
    return { found: true, visible: visible(d), name: titles.map(e => e?.textContent.trim() ?? '').join(' '),
      namedByVisibleTitle: titles.length > 0 && titles.every(e => visible(e) && /^H[1-6]$/.test(e.tagName) && d.contains(e)),
      initialFocusInside: d.contains(document.activeElement), focusableCount: [...d.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')].filter(visible).length,
      width: rect.width };
  }, config.dialog);
  if (!state.visible) return { buttons, dialog: state };
  // Light-DOM containment cannot establish focus behavior inside these surfaces.
  // Re-sample before Escape: Tab handlers can open an overlay after initial focus.
  const scopeRisks = () => tab.playwright.evaluate(selector => {
    const d = document.querySelector(selector);
    if (!d) return ['missing-dialog'];
    const risks = [];
    if (d.querySelector('iframe,object,embed')) risks.push('embedded-content');
    if ([d, ...d.querySelectorAll('*')].some(e => e.shadowRoot)) risks.push('shadow-root');
    const visible = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    if ([...d.querySelectorAll('details')].some(e => !e.querySelector(':scope > summary'))) risks.push('implicit-summary');
    if ([...document.querySelectorAll('[data-a11y-dialog-ignore-focus-trap]')].some(visible)) risks.push('focus-trap-exception');
    if ([...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],:popover-open')]
      .some(e => e !== d && !e.contains(d) && visible(e))) risks.push('nested-overlay');
    return risks;
  }, config.dialog);
  state.focusScopeRisks = await scopeRisks();
  state.roleNameMatched = await tab.playwright.getByRole('dialog', { name: config.name, exact: true }).count() === 1;
  const inside = () => tab.playwright.evaluate(selector => document.querySelector(selector)?.contains(document.activeElement) ?? false, config.dialog);
  state.forward = []; state.backward = [];
  for (const [key, output] of [['Tab', state.forward], ['shift+Tab', state.backward]]) {
    for (let i = 0; i <= Math.min(state.focusableCount, 20); i++) {
      await tab.pressKey(null, key); output.push(await inside());
      state.focusScopeRisks = [...new Set([...state.focusScopeRisks, ...await scopeRisks()])];
    }
  }
  buttons.push(...await collectButtons(config.dialogButtons));
  state.escapeScopeRisks = await scopeRisks();
  await tab.pressKey(null, 'Escape');
  await tab.getAXState({ emit: false }); // Observe after native close-event processing.
  // Native dialog close handlers may run on the next rendering task. Sample the
  // settled focus, rather than the browser's transient automatic restoration.
  state.escapeAllowed = config.escapeAllowed ?? true;
  state.exceptionReason = config.exceptionReason;
  state.escapeClosed = !await tab.playwright.locator(config.dialog).isVisible();
  state.returnFocus = undefined;
  if (state.escapeClosed) {
    state.returnFocusSamples = [];
    for (let i = 0; i < 12; i++) {
      await delay(100);
      state.returnFocusSamples.push(await focus() === config.trigger.slice(1));
    }
    state.returnFocus = state.returnFocusSamples.every(Boolean);
  }
  if (!state.escapeClosed && config.close) {
    await tab.playwright.locator(config.close).click();
    await tab.getAXState({ emit: false });
    if (state.escapeAllowed === false) state.returnFocus = await focus() === config.trigger.slice(1);
  }
  return { buttons, dialog: state };
}

export const journeys = {
  settings: { buttons: ['#reset', '#save'], trigger: '#save', dialog: '#confirm', name: 'Save workspace preferences?', dialogButtons: ['#cancel', '#apply'], close: '#cancel' },
  codex: { buttons: ['#open-dialog'], trigger: '#open-dialog', dialog: '#example-dialog', name: 'Review your changes', dialogButtons: ['#cancel-dialog', '#continue-dialog'], close: '#cancel-dialog' },
  grok: { buttons: ['#open-dialog'], trigger: '#open-dialog', dialog: '#dialog', name: 'Create project', dialogButtons: ['#cancel-action', '#confirm-action'], close: '#cancel-action' },
};
