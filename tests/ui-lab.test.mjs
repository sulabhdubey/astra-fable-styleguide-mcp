import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startUiLab } from '../scripts/serve-ui-lab.mjs';

test('settings uses only generated canonical custom properties', async () => {
  const html = await readFile('examples/settings/index.html', 'utf8');
  const css = await readFile('generated/css/tokens.css', 'utf8');
  const available = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(x => x[1]));
  for (const [, property] of html.matchAll(/var\((--[\w-]+)/g)) assert.ok(available.has(property), `Undefined canonical property ${property}`);
});

test('local UI server allowlists fixtures and binds served artifact bytes', async () => {
  const server = await startUiLab(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const good = await (await fetch(`${url}/case.json`)).json();
    const broken = await (await fetch(`${url}/case.json?defect=target`)).json();
    assert.notEqual(good.artifactSha256, broken.artifactSha256);
    assert.equal(good.contract.specSha256, broken.contract.specSha256);
    assert.equal((await fetch(`${url}/?case=../../package.json`)).status, 400);
    assert.equal((await fetch(`${url}/?defect=unknown`)).status, 400);
    assert.equal((await fetch(`${url}/package.json`)).status, 404);
    assert.equal((await fetch(url, {method:'POST'})).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
