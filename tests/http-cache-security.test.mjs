import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const astroRequire = createRequire(require.resolve('astro/package.json'));
const CachePolicy = astroRequire('http-cache-semantics');
const request = { url: 'https://fixture.invalid/account', method: 'GET', headers: { host: 'fixture.invalid' } };

test('zeroed shared-cache entries cannot be revived by max-stale or stale-while-revalidate', () => {
  for (const headers of [
    { 'cache-control': 'max-age=300', 'set-cookie': 'fixture-session=example' },
    { 'cache-control': 'max-age=300, stale-while-revalidate=60', 'set-cookie': 'fixture-session=example' },
    { 'cache-control': 'no-cache, stale-while-revalidate=60' },
    { 'cache-control': 'no-store, stale-while-revalidate=60' }
  ]) {
    const policy = new CachePolicy(request, { status: 200, headers });
    assert.equal(policy.maxAge(), 0);
    for (const directive of ['', 'max-stale', 'max-stale=999999999']) {
      const incoming = { ...request, headers: { ...request.headers, 'cache-control': directive } };
      assert.equal(policy.satisfiesWithoutRevalidation(incoming), false, JSON.stringify(headers));
      const result = policy.evaluateRequest(incoming);
      assert.equal(result.response, undefined);
      assert.equal(result.revalidation.synchronous, true);
    }
  }
});

test('normal public caching and positive-age stale allowances remain available', () => {
  const policy = new CachePolicy(request, { status: 200, headers: { 'cache-control': 'public, max-age=60' } });
  assert.equal(policy.satisfiesWithoutRevalidation(request), true);
  const now = policy.now(); policy.now = () => now + 120000;
  assert.equal(policy.satisfiesWithoutRevalidation({ ...request, headers: { ...request.headers, 'cache-control': 'max-stale=300' } }), true);
});
