import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { PUBLIC_STYLE_TOOL_NAMES, StyleConstitutionClient } from '../packages/sdk/dist/index.js';

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('TypeScript client completes a local official-SDK MCP lifecycle', { timeout: 20000 }, async () => {
  const port = await freePort();
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/mcp-server/src/official-server.ts'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', MCP_ENABLE_WRITES: 'false' },
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const client = new StyleConstitutionClient({ endpoint });
  const legacyClient = new StyleConstitutionClient({ endpoint, protocolMode: 'legacy' });
  try {
    let ready = false;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try { if ((await client.health()).ok === true) { ready = true; break; } } catch { /* Server is starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, `Server did not become ready: ${stderr.slice(-1000)}`);
    const browserVisit = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
    assert.equal(browserVisit.status, 302);
    assert.equal(browserVisit.headers.get('location'), 'https://sulabhdubey.github.io/astra-fable-styleguide-mcp/');
    const browserMcpVisit = await fetch(endpoint, { headers: { accept: 'text/html' }, redirect: 'manual' });
    assert.equal(browserMcpVisit.status, 302);
    assert.equal(browserMcpVisit.headers.get('location'), 'https://github.com/sulabhdubey/astra-fable-styleguide-mcp#production-mcp');
    const protocolGet = await fetch(endpoint, { headers: { accept: 'application/json' }, redirect: 'manual' });
    assert.equal(protocolGet.status, 405);
    await client.connect();
    assert.equal(client.protocolEra(), 'modern');
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), [...PUBLIC_STYLE_TOOL_NAMES].sort());
    for (const tool of tools) {
      assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, tool.name);
    }
    assert.equal((await client.getStyleManifest()).version, '0.5.1');
    assert.ok(await client.getDesignTokens('space'));
    assert.equal((await client.getComponentRules('button')).id, 'button');
    const sameVersion = await client.compareSpecVersions('0.1.0', '0.1.0');
    assert.equal(sameVersion.totalChanges, 0);
    const comparison = await client.compareSpecVersions('0.1.0', '0.2.0');
    assert.equal(comparison.totalChanges, 12);
    assert.equal(comparison.truncated, false);
    assert.ok(comparison.changes.some(change => change.path === 'spec/tokens/semantic.json#/semantic/border/danger' && change.kind === 'added'));
    const report = await client.checkStyleCompliance('.x{padding:13px}');
    assert.equal(report.status, 'fail');
    assert.equal(report.violations[0].ruleId, 'STYLE-SPACE-001');
    await assert.rejects(client.callReadTool('publish_release'), /outside the public read API/);
    await assert.rejects(client.getComponentRules('no-such-component'), /Unknown component/);
    await legacyClient.connect();
    assert.equal(legacyClient.protocolEra(), 'legacy');
    assert.deepEqual((await legacyClient.listTools()).tools.map(tool => tool.name).sort(), [...PUBLIC_STYLE_TOOL_NAMES].sort());
    assert.equal((await legacyClient.getStyleManifest()).version, '0.5.1');
    const probe = JSON.parse(execFileSync(process.execPath, ['scripts/probe-mcp.mjs', client.endpoint()], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 10000,
    }));
    assert.equal(probe.protocolEra, 'modern');
    assert.equal(probe.version, '0.5.1');
    assert.equal(probe.expectedToolNamesOnly, true);
    assert.deepEqual(probe.toolNames, [...PUBLIC_STYLE_TOOL_NAMES].sort());
  } finally {
    await legacyClient.close();
    await client.close();
    child.kill('SIGTERM');
  }
});
