/* global structuredClone */
import test from 'node:test';
import assert from 'node:assert/strict';

const integration = await import('../scripts/dembrandt-tokens.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('dembrandt-tokens.mjs')) return null;
  throw error;
});
function api() { assert.ok(integration, 'The declared-token integration must exist'); return integration; }
const hex = '#2563eb';
function exported(changes = {}) {
  return { meta: { schemaVersion: '1.17.0', snapshotId: 'fixture-v1', viewport: { width: 900, height: 600 }, httpStatus: 200, fontsReady: true, degraded: [], errors: [], ...changes },
    colors: { palette: [{ color: hex, normalized: hex, count: 1, confidence: 'high', tokens: ['--accent'] }], cssVariables: { '--accent': { value: hex, hex } } } };
}
function observed(changes = {}) {
  return { viewport: { width: 900, height: 600 }, scope: 'body', values: [{ token: '--accent', raw: 'rgb(37, 99, 235)', rgba: [37, 99, 235, 255] }], issues: [], ...changes };
}
function checked(value, observation = observed()) {
  const { importDembrandtExport, evaluateTokenObservations } = api();
  return evaluateTokenObservations(importDembrandtExport(value), observation);
}

test('declared tokens compare normalized browser evidence and retain snapshot and scope', () => {
  const result = checked(exported());
  assert.equal(result.status, 'match');
  assert.equal(result.exitCode, 0);
  assert.equal(result.snapshotId, 'fixture-v1');
  assert.equal(result.scope, 'body');
  assert.deepEqual(result.checks.map(check => [check.token, check.status, check.expected]), [['--accent', 'match', hex]]);
  assert.match(result.claimBoundary, /drift/i);
});

test('changed tokens mismatch; missing and transparent tokens are incomplete', () => {
  assert.equal(checked(exported(), observed({ values: [{ token: '--accent', raw: 'red', rgba: [255, 0, 0, 255] }] })).status, 'mismatch');
  assert.equal(checked(exported(), observed({ values: [{ token: '--accent', raw: '', rgba: null }] })).status, 'incomplete');
  assert.equal(checked(exported(), observed({ values: [{ token: '--accent', raw: 'transparent', rgba: [0, 0, 0, 0] }] })).status, 'incomplete');
});

test('observed colors without tokens remain unverified including empty token lists', () => {
  for (const tokens of [undefined, []]) {
    const value = exported(); value.colors.palette[0].tokens = tokens;
    const result = checked(value);
    assert.equal(result.status, 'unverified'); assert.equal(result.exitCode, 2);
    assert.equal(result.checks[0].token, null);
  }
});

test('only explicit supported schema versions are accepted, without shape inference', () => {
  assert.equal(checked(exported({ schemaVersion: '1.18.0' })).status, 'match');
  for (const schemaVersion of [undefined, '1.16.0', '1.17.1', '2.0.0']) {
    const result = checked(exported({ schemaVersion }));
    assert.equal(result.status, 'incomplete'); assert.match(result.issues.join(' '), /schema/);
  }
});

test('missing source metadata, bot wall and merged pages cannot authorize a match', () => {
  for (const changes of [{ snapshotId: undefined }, { viewport: undefined }, { viewport: { width: 0, height: 600 } }, { httpStatus: undefined }, { httpStatus: null }, { httpStatus: 403 }, { crawl: { pagesFound: 2 } }]) {
    assert.equal(checked(exported(changes)).status, 'incomplete', JSON.stringify(changes));
  }
});

test('color extraction failures block color comparison; unrelated failures remain warnings', () => {
  assert.equal(checked(exported({ degraded: ['colors'] })).status, 'incomplete');
  assert.equal(checked(exported({ errors: [{ stage: 'colors', reason: 'failed' }] })).status, 'incomplete');
  const result = checked(exported({ fontsReady: false, degraded: ['typography'], errors: [{ stage: 'screenshot', reason: 'failed' }] }));
  assert.equal(result.status, 'match'); assert.ok(result.warnings.length >= 2);
});

test('viewport mismatch and unavailable live evidence take precedence over mismatches', () => {
  assert.equal(checked(exported(), observed({ viewport: { width: 390, height: 600 } })).status, 'incomplete');
  assert.equal(checked(exported(), observed({ issues: ['resource_blocked'], values: [{ token: '--accent', raw: 'red', rgba: [255, 0, 0, 255] }] })).status, 'incomplete');
  assert.equal(checked(exported(), null).status, 'incomplete');
});

test('duplicate token evidence collapses; conflicting expected values stay incomplete', () => {
  const value = exported(); value.colors.palette.push(structuredClone(value.colors.palette[0]));
  assert.equal(checked(value).checks.length, 1);
  value.colors.palette[1].normalized = '#ff0000';
  assert.equal(checked(value).status, 'incomplete');
});

test('unsupported color inputs and malformed records fail safely', () => {
  const value = exported(); value.colors.palette[0].normalized = 'url(https://example.invalid/secret)';
  assert.equal(checked(value).status, 'incomplete');
  value.colors.palette[0].normalized = hex; value.colors.palette[0].tokens = ['--accent; color:red'];
  assert.equal(checked(value).status, 'incomplete');
  assert.equal(checked({}).status, 'incomplete');
  value.colors.palette = []; assert.equal(checked(value).status, 'incomplete');
});

test('HTML report escapes untrusted snapshot text and exposes four status definitions', () => {
  const result = checked(exported({ snapshotId: '<img src=x onerror=alert(1)>' }));
  const html = api().formatTokenReport(result, 'html');
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img/);
  for (const status of ['match', 'mismatch', 'unverified', 'incomplete']) assert.match(html, new RegExp(status));
});

test('malformed timeout/crawl metadata and contradictory declared color evidence are incomplete', () => {
  assert.equal(checked(exported({ timeouts: {} })).status, 'incomplete');
  assert.equal(checked(exported({ crawl: { pagesFound: 1, pages: ['https://example.invalid/a', 'https://example.invalid/b'] } })).status, 'incomplete');
  const value = exported(); value.colors.cssVariables['--accent'].hex = '#ff0000';
  assert.equal(checked(value).status, 'incomplete');
});

test('unreproduced extraction profiles cannot authorize token matches', () => {
  for (const flags of [{ mobile: true }, { mobile: 'yes' }, { stealth: 1 }, { browser: 'firefox' }, { stealth: true }, { locale: 'fi-FI' }, [], { darkMode: 'yes' }]) {
    assert.equal(checked(exported({ flags })).status, 'incomplete', JSON.stringify(flags));
  }
});

test('every source-supported palette dependency fails closed in both metadata channels and schemas', () => {
  for (const schemaVersion of ['1.17.0', '1.18.0']) for (const stage of ['color', 'colors', 'tokens', 'cssVariables', 'logo', 'manifest', 'svg-logo-colors', 'gradients', 'gradient-colors', 'hover-focus', 'dark-mode', 'mobile', 'reveal']) {
    for (const metadata of [{ degraded: [stage] }, { errors: [{ stage, reason: 'fixture failure' }] }]) {
      const result = checked(exported({ schemaVersion, ...metadata }));
      assert.equal(result.status, 'incomplete', `${schemaVersion} ${JSON.stringify(metadata)}`);
      assert.equal(result.exitCode, 2);
      assert.ok(result.issues.some(issue => issue.startsWith('color_extraction_')));
    }
  }
});

test('unknown extraction failures are incomplete; known unrelated failures remain warnings', () => {
  for (const metadata of [{ degraded: ['future-palette-stage'] }, { errors: [{ stage: 'future-palette-stage' }] }]) {
    assert.equal(checked(exported(metadata)).status, 'incomplete');
  }
  for (const stage of ['typography', 'spacing', 'borderRadius', 'borders', 'shadows', 'buttons', 'inputs', 'links', 'badges', 'breakpoints', 'iconSystem', 'frameworks', 'siteName', 'motion', 'voice', 'screenshot']) {
    const result = checked(exported({ degraded: [stage], errors: [{ stage }] }));
    assert.equal(result.status, 'match', stage);
    assert.ok(result.warnings.length);
  }
});

test('standalone cssVariables tokens are checked even when palette deduplication removes their entries', () => {
  const value = exported(); value.colors.cssVariables['--reserve'] = { value: '#db2777', hex: '#db2777' };
  const live = observed(); live.values.push({ token: '--reserve', raw: '#db2777', rgba: [219, 39, 119, 255] });
  const result = checked(value, live);
  assert.equal(result.status, 'match'); assert.equal(result.checks.length, 2);
  assert.equal(result.checks[1].token, '--reserve');
  live.values[1].rgba = [255, 0, 0, 255]; assert.equal(checked(value, live).status, 'mismatch');
  live.values.pop(); assert.equal(checked(value, live).status, 'incomplete');
  value.colors.cssVariables['--reserve'] = '#db2777';
  assert.equal(checked(value).checks.length, 2);
});

test('malformed or contradictory cssVariables evidence cannot be silently omitted', () => {
  for (const cssVariables of [[], 'invalid', { '--accent': null }, { '--accent': '#ff0000' }, { '--reserve': { value: 'oklch(.5 .2 20)' } }, { 'invalid name': { hex: '#db2777' } }]) {
    const value = exported(); value.colors.cssVariables = cssVariables;
    assert.equal(checked(value).status, 'incomplete', JSON.stringify(cssVariables));
  }
});
