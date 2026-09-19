import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { StyleConstitutionClient } from '../packages/sdk/dist/index.js';

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('governance MCP tool is admin-only while public read tools remain available', { timeout: 20000 }, async () => {
  const port = await freePort();
  const token = randomUUID();
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/mcp-server/src/official-server.ts'], {
    cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', MCP_ENABLE_WRITES: 'true', MCP_ENABLE_RELEASE_TOOL: 'false', MCP_ENABLE_AI_ORCHESTRATION: 'false', MCP_ADMIN_TOKEN: token },
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const anonymous = new StyleConstitutionClient({ endpoint });
  const authorized = new StyleConstitutionClient({ endpoint, fetchImpl: (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  } });
  try {
    let ready = false;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try { if ((await anonymous.health()).ok === true) { ready = true; break; } } catch { /* Server is starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, `Server did not become ready: ${stderr.slice(-1000)}`);
    await anonymous.connect();
    const { tools } = await anonymous.listTools();
    assert.ok(tools.some(tool => tool.name === 'get_governance_activity'));
    assert.equal((await anonymous.getStyleManifest()).version, '0.1.0');
    const denied = await anonymous.connection.callTool({ name: 'get_governance_activity', arguments: {} });
    assert.equal(denied.isError, true);
    await authorized.connect();
    const granted = await authorized.connection.callTool({ name: 'get_governance_activity', arguments: {} });
    assert.equal(granted.isError, undefined);
    const activity = JSON.parse(granted.content.find(block => block.type === 'text').text);
    assert.equal(activity.durable, false);
    assert.equal(activity.identityAssurance, 'shared-admin-credential');
  } finally {
    await anonymous.close();
    await authorized.close();
    child.kill('SIGTERM');
  }
});
