import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBundle } from './helpers.mjs';
import { checkStyleCompliance } from '../dist/packages/compliance/src/index.js';

test('CSS diagnostics carry original source locations and ignore comments and strings', async () => {
  const { tokens } = await loadBundle();
  const source = '<style>\n/* color:#ABCDEF; margin:27px */\n.x { content:"27px #ABCDEF"; color:#abc; margin:13.5px; }\n</style>';
  const result = checkStyleCompliance(source, tokens);
  assert.equal(result.compliant, false);
  assert.deepEqual(result.violations.map(({ ruleId, match, line }) => ({ ruleId, match, line })), [
    { ruleId: 'STYLE-COLOR-001', match: '#abc', line: 3 },
    { ruleId: 'STYLE-SPACE-001', match: '13.5px', line: 3 },
  ]);
  assert.ok(result.violations.every(v => v.column > 0));
  assert.ok(result.limitations.some(v => v.includes('does not parse all CSS')));
});

test('inline styles are checked while prose and attributes are outside declared coverage', async () => {
  const { tokens } = await loadBundle();
  const source = '<p title="margin:27px" style="color:#ABCDEF; padding:27px">27px</p>';
  const result = checkStyleCompliance(source, tokens);
  assert.deepEqual(result.violations.map(v => v.match), ['#ABCDEF', '27px']);
  const unchecked = checkStyleCompliance('<p>27px</p>', tokens);
  assert.equal(unchecked.warnings.length, 1);
  assert.equal(unchecked.status, 'not_checked');
  assert.equal(unchecked.compliant, false);
});

test('resolved token values pass and raw CSS still gets checked', async () => {
  const { tokens } = await loadBundle();
  const result = checkStyleCompliance('.x{color:#1d4ed8;padding:16px;border:1px solid #E2E8F0}', tokens);
  assert.equal(result.compliant, true);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(checkStyleCompliance('.x{content:"<foo>";padding:27px}', tokens).violations.map(v => v.match), ['27px']);
});

test('large invalid input has bounded findings and still fails', async () => {
  const { tokens } = await loadBundle();
  const result = checkStyleCompliance(`.x{${'margin:27px;'.repeat(2000)}}`, tokens);
  assert.equal(result.status, 'fail');
  assert.equal(result.compliant, false);
  assert.equal(result.violations.length, 200);
  assert.equal(result.truncated, true);
  assert.ok(result.warnings.some(v => v.includes('capped')));
});

test('unknown canonical token references fail while valid and app-local variables pass', async () => {
  const { tokens } = await loadBundle();
  const source = '<style>\n/* var(--semantic-text-missing) */\n.x { color: var(--semantic-text-primary); background: var(--semantic-surface-priamry); border-color: var(--app-brand); padding: var(--space-4); margin: var(--space-999); border-radius: var(--radius-mdd); outline-color: var(--color-blue-999); }\n</style>';
  const result = checkStyleCompliance(source, tokens);
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.violations.map(v => [v.ruleId, v.match, v.line]), [
    ['STYLE-CSS-TOKEN-001', 'var(--semantic-surface-priamry', 3],
    ['STYLE-CSS-TOKEN-001', 'var(--space-999', 3],
    ['STYLE-CSS-TOKEN-001', 'var(--radius-mdd', 3],
    ['STYLE-CSS-TOKEN-001', 'var(--color-blue-999', 3],
  ]);
  assert.ok(result.checksPerformed.some(check => check.includes('Canonical token')));
  assert.ok(result.limitations.some(limit => limit.includes('app-local')));
});
