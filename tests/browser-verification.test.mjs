import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContract, evaluateObservations, createRepairPacket } from '../packages/browser-verification/src/index.mjs';

const button = JSON.parse(await readFile('spec/components/button.json'));
const dialog = JSON.parse(await readFile('spec/components/dialog.json'));
const rules = JSON.parse(await readFile('spec/accessibility/rules.json'));
const contract = createContract({ button, dialog, rules });
const sample = () => ({
  buttons: [{ selector: '#save', width: 80, height: 40, visible: true, focused: true, focusVisible: true, outlineWidth: 3, outlineStyle: 'solid', outlineColor: 'rgb(37, 99, 235)', adjacentColor: 'rgb(255, 255, 255)', boxShadow: 'none', backgroundImage: 'none' }],
  dialog: { found: true, visible: true, namedByVisibleTitle: true, roleNameMatched: true, initialFocusInside: true, forward: [true, true, true], backward: [true, true, true], focusableCount: 2, escapeAllowed: true, escapeClosed: true, returnFocus: true },
});
test('observed conforming interactions pass and bind evidence to the canonical contract', () => {
  const report = evaluateObservations(contract, sample(), { artifactSha256: 'a'.repeat(64) });
  assert.equal(report.status, 'pass');
  assert.match(report.specSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.artifactSha256, 'a'.repeat(64));
  assert.ok(report.checks.every(c => c.ruleId.startsWith('STYLE-')));
});
test('small target, missing ring, unnamed dialog and escaping focus fail separately', () => {
  const observed = sample();
  Object.assign(observed.buttons[0], { height: 24, outlineWidth: 0 });
  Object.assign(observed.dialog, { namedByVisibleTitle: false, initialFocusInside: false, forward: [true, false, true], escapeClosed: false, returnFocus: false });
  const report = evaluateObservations(contract, observed);
  for (const check of ['target', 'focus', 'name', 'initial-focus', 'containment', 'escape', 'return-focus']) {
    assert.ok(report.checks.some(c => c.check === check && c.status === 'fail'), check);
  }
});
test('missing targets, incomplete traversal, unsupported focus styles never silently pass', () => {
  assert.equal(evaluateObservations(contract, { buttons: [], dialog: null }).status, 'not_checked');
  const observed = sample();
  observed.dialog.forward = [true];
  assert.equal(evaluateObservations(contract, observed).checks.find(c => c.check === 'containment').status, 'not_checked');
  Object.assign(observed.buttons[0], { outlineWidth: 0, boxShadow: '0 0 0 3px blue' });
  assert.equal(evaluateObservations(contract, observed).checks.find(c => c.check === 'focus').status, 'unsupported');
});
test('low contrast ring fails; invalid measurements and stale contracts are rejected', () => {
  const observed = sample(); observed.buttons[0].outlineColor = 'rgb(250, 250, 250)';
  assert.equal(evaluateObservations(contract, observed).checks.find(c => c.check === 'focus-contrast').status, 'fail');
  observed.buttons[0].width = NaN;
  assert.notEqual(evaluateObservations(contract, observed).status, 'pass');
  assert.throws(() => createContract({ button: { ...button, accessibility: { ...button.accessibility, minimumTarget: 'auto' } }, dialog, rules }));
});
test('non-dismissible exception requires explicit reason and close-path focus return', () => {
  const observed = sample(); Object.assign(observed.dialog, { escapeAllowed: false, escapeClosed: false, exceptionReason: 'A required confirmation is pending.' });
  assert.equal(evaluateObservations(contract, observed).status, 'pass');
  observed.dialog.exceptionReason = '';
  assert.equal(evaluateObservations(contract, observed).checks.find(c => c.check === 'escape').status, 'fail');
});

test('report identity cannot override calculated status or spec binding', () => {
  const report = evaluateObservations(contract, { buttons: [] }, { status: 'pass', specSha256: 'forged', artifactSha256: 'a'.repeat(64) });
  assert.equal(report.status, 'not_checked');
  assert.equal(report.specSha256, contract.specSha256);
  assert.throws(() => evaluateObservations(contract, sample(), { artifactSha256: 'not-a-hash' }));
});

test('repair packets preserve rule/path/evidence and reject stale or unmapped findings', () => {
  const observed = sample(); observed.buttons[0].height = 24;
  const report = evaluateObservations(contract, observed, { artifactSha256: 'a'.repeat(64) });
  const input = { report, expectedSpecSha256: contract.specSha256, expectedArtifactSha256: 'a'.repeat(64), targetPaths: { '#save': 'examples/settings/index.html', dialog: 'examples/settings/index.html' } };
  const packet = createRepairPacket(input);
  assert.equal(packet.findings.length, 1);
  assert.equal(packet.findings[0].ruleId, 'STYLE-A11Y-009');
  assert.equal(packet.findings[0].evidenceKind, 'observed');
  assert.equal(packet.findings[0].path, 'examples/settings/index.html');
  assert.throws(() => createRepairPacket({ ...input, expectedArtifactSha256: 'b'.repeat(64) }));
  assert.throws(() => createRepairPacket({ ...input, targetPaths: {} }));
});

test('native automatic focus treatment is unsupported, not a fabricated contrast failure',()=>{
  const observed=sample();Object.assign(observed.buttons[0],{outlineWidth:0.666667,outlineStyle:'auto',outlineColor:'rgb(16, 16, 16)'});
  const checks=evaluateObservations(contract,observed).checks;
  assert.equal(checks.find(c=>c.check==='focus').status,'unsupported');
  assert.equal(checks.find(c=>c.check==='focus-contrast').status,'unsupported');
});

test('unsupported dialog focus surfaces cannot produce a containment pass', () => {
  for (const risk of ['embedded-content', 'shadow-root', 'nested-overlay']) {
    const observed = sample(); observed.dialog.focusScopeRisks = [risk];
    const report = evaluateObservations(contract, observed);
    assert.equal(report.checks.find(c => c.check === 'containment').status, 'unsupported', risk);
    assert.notEqual(report.status, 'pass');
  }
});
test('nested overlay Escape is incomplete rather than a dialog dismissal verdict', () => {
  for (const closed of [true, false]) {
    const observed = sample(); Object.assign(observed.dialog, { escapeScopeRisks: ['nested-overlay'], escapeClosed: closed });
    const report = evaluateObservations(contract, observed);
    assert.equal(report.checks.find(c => c.check === 'escape').status, 'unsupported');
    assert.equal(report.checks.find(c => c.check === 'return-focus').status, 'unsupported');
  }
});
