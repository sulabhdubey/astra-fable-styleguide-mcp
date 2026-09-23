import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const astraToken = randomUUID();
  const fableToken = randomUUID();
  const dir = await mkdtemp(join(tmpdir(), 'style-governance-mcp-'));
  const auditPath = join(dir, 'audit.jsonl');
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/mcp-server/src/official-server.ts'], {
    cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', MCP_ENABLE_WRITES: 'true', MCP_ENABLE_RELEASE_TOOL: 'false', MCP_ENABLE_AI_ORCHESTRATION: 'false', MCP_ADMIN_TOKEN: token, MCP_AUDIT_PATH: auditPath, MCP_ASTRA_APPROVAL_TOKEN: astraToken, MCP_FABLE_APPROVAL_TOKEN: fableToken },
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const anonymous = new StyleConstitutionClient({ endpoint });
  let roleToken;
  const authorized = new StyleConstitutionClient({ endpoint, fetchImpl: (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    if (roleToken) headers.set('x-role-approval-token', roleToken);
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
    const currentManifest = await anonymous.getStyleManifest();
    assert.equal(currentManifest.version, '0.5.0');
    const denied = await anonymous.connection.callTool({ name: 'get_governance_activity', arguments: {} });
    assert.equal(denied.isError, true);
    await authorized.connect();
    const granted = await authorized.connection.callTool({ name: 'get_governance_activity', arguments: {} });
    assert.equal(granted.isError, undefined);
    const activity = JSON.parse(granted.content.find(block => block.type === 'text').text);
    assert.equal(activity.durable, false);
    assert.equal(activity.audit.durable, true);
    assert.equal(activity.identityAssurance, 'role-scoped-credentials');
    const base = { baseVersion: currentManifest.version, summary: 'disabled button semantics', tradeoffs: [], unresolved: [] };
    const proposals = [
      { ...base, id: 'MCP-ADD-A', author: 'astra', changes: [{ path: 'tokens.semantic.action.primary.disabledBackground', value: { $type: 'color', $value: '{color.slate.200}' } }] },
      { ...base, id: 'MCP-ADD-F', author: 'fable', changes: [{ path: 'components.button.tokens.disabledBackground', value: '{semantic.action.primary.disabledBackground}' }] },
    ];
    for (const proposal of proposals) {
      const response = await authorized.connection.callTool({ name: 'create_style_proposal', arguments: { id: proposal.id, proposalJson: JSON.stringify(proposal) } });
      assert.equal(response.isError, undefined);
    }
    const round = await authorized.connection.callTool({ name: 'start_consensus_round', arguments: { astraProposalId: 'MCP-ADD-A', fableProposalId: 'MCP-ADD-F' } });
    assert.equal(round.isError, undefined);
    const candidate = JSON.parse(round.content.find(block => block.type === 'text').text);
    assert.equal(candidate.status, 'candidate_ready');
    const status = await authorized.connection.callTool({ name: 'get_consensus_status', arguments: { candidateHash: candidate.candidateHash } });
    assert.equal(JSON.parse(status.content.find(block => block.type === 'text').text).changeCount, 2);
    const deniedApproval = await authorized.connection.callTool({ name: 'approve_candidate', arguments: { candidateHash: candidate.candidateHash, actor: 'astra' } });
    assert.equal(deniedApproval.isError, true);
    roleToken = astraToken;
    const astraApproval = await authorized.connection.callTool({ name: 'approve_candidate', arguments: { candidateHash: candidate.candidateHash, actor: 'astra' } });
    assert.equal(astraApproval.isError, undefined);
    const wrongRole = await authorized.connection.callTool({ name: 'approve_candidate', arguments: { candidateHash: candidate.candidateHash, actor: 'fable' } });
    assert.equal(wrongRole.isError, true);
    roleToken = fableToken;
    const fableApproval = await authorized.connection.callTool({ name: 'approve_candidate', arguments: { candidateHash: candidate.candidateHash, actor: 'fable' } });
    assert.equal(fableApproval.isError, undefined);
    const audited = JSON.parse((await authorized.connection.callTool({ name: 'get_governance_activity', arguments: {} })).content.find(block => block.type === 'text').text);
    assert.equal(audited.audit.eventCount, 5);
    const auditBytes = await readFile(auditPath, 'utf8');
    assert.equal(auditBytes.includes(astraToken), false);
    assert.equal(auditBytes.includes(fableToken), false);
    await assert.rejects(anonymous.getDesignTokens('semantic.action.primary.disabledBackground'), /Unknown token scope/);
  } finally {
    await anonymous.close();
    await authorized.close();
    child.kill('SIGTERM');
    await rm(dir, { recursive: true, force: true });
  }
});
