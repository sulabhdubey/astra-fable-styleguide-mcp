import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { StyleConstitutionClient } from '../packages/sdk/dist/index.js';

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('TypeScript client completes a local official-SDK MCP lifecycle', { timeout: 20000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/mcp-server/src/official-server.ts'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', MCP_ENABLE_WRITES: 'false' },
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const client = new StyleConstitutionClient({ endpoint: `http://127.0.0.1:${port}/mcp` });
  try {
    let ready = false;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try { if ((await client.health()).ok === true) { ready = true; break; } } catch { /* Server is starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, `Server did not become ready: ${stderr.slice(-1000)}`);
    await client.connect();
    const { tools } = await client.listTools();
    assert.equal(tools.length, 8);
    assert.equal((await client.getStyleManifest()).version, '0.1.0');
    assert.ok(await client.getDesignTokens('space'));
    assert.equal((await client.getComponentRules('button')).id, 'button');
    const sameVersion = await client.compareSpecVersions('0.1.0', '0.1.0');
    assert.equal(sameVersion.totalChanges, 0);
    const unavailable = await client.compareSpecVersions('0.1.0', '0.2.0');
    assert.deepEqual(unavailable.availableVersions, ['0.1.0']);
    const report = await client.checkStyleCompliance('.x{padding:13px}');
    assert.equal(report.status, 'fail');
    assert.equal(report.violations[0].ruleId, 'STYLE-SPACE-001');
    await assert.rejects(client.callReadTool('publish_release'), /outside the public read API/);
    await assert.rejects(client.getComponentRules('no-such-component'), /Unknown component/);
  } finally {
    await client.close();
    child.kill('SIGTERM');
  }
});
