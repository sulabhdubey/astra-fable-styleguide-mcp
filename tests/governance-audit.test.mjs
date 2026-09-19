import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AuditLedger } from '../dist/packages/governance-audit/src/index.js';
import { StyleService } from '../dist/apps/mcp-server/src/service.js';
import { loadBundle } from './helpers.mjs';

test('local audit survives restart, detects edits, and contains no proposal values or credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'style-audit-'));
  const path = join(dir, 'events.jsonl');
  try {
    const ledger = new AuditLedger(path);
    assert.equal((await stat(path)).isFile(), true);
    const bundle = await loadBundle();
    const service = new StyleService({ ...bundle, principles: {}, patterns: [], antiPatterns: {}, decisions: {} }, new Map(), {
      auditLedger: ledger,
      roleApprovalTokens: { astra: 'astra-private-credential', fable: 'fable-private-credential' },
    });
    const circular = { id: 'CIRCULAR', author: 'astra', baseVersion: '0.2.0', summary: 'invalid', changes: [], tradeoffs: [], unresolved: [] };
    circular.tradeoffs.push(circular);
    assert.throws(() => service.createProposal('CIRCULAR', circular, 'admin-private-credential', 'admin-private-credential'), /circular/i);
    assert.equal(ledger.status().eventCount, 0);
    const base = { baseVersion: '0.2.0', summary: 'private proposal text', tradeoffs: [], unresolved: [] };
    service.createProposal('AUD-A', { ...base, id: 'AUD-A', author: 'astra', changes: [{ path: 'tokens.radius.md.$value', value: '12px' }] }, 'admin-private-credential', 'admin-private-credential');
    service.createProposal('AUD-F', { ...base, id: 'AUD-F', author: 'fable', changes: [{ path: 'tokens.radius.md.$value', value: '12px' }] }, 'admin-private-credential', 'admin-private-credential');
    const round = await service.startConsensusRound('AUD-A', 'AUD-F', 'admin-private-credential', 'admin-private-credential');
    assert.equal(round.status, 'candidate_ready');
    assert.throws(() => service.approveCandidate(round.candidateHash, 'astra', 'admin-private-credential', 'admin-private-credential'), /Role approval credential/);
    assert.throws(() => service.approveCandidate(round.candidateHash, 'fable', 'admin-private-credential', 'admin-private-credential', 'astra-private-credential'), /Role approval credential/);
    service.approveCandidate(round.candidateHash, 'astra', 'admin-private-credential', 'admin-private-credential', 'astra-private-credential');
    service.approveCandidate(round.candidateHash, 'fable', 'admin-private-credential', 'admin-private-credential', 'fable-private-credential');
    const status = service.getConsensusStatus(round.candidateHash, 'admin-private-credential', 'admin-private-credential');
    assert.equal(status.roleApprovalsComplete, true);
    assert.equal(status.identityAssurance, 'role-scoped-credentials');
    const activity = service.getGovernanceActivity('admin-private-credential', 'admin-private-credential');
    assert.equal(activity.durable, false);
    assert.equal(activity.audit.durable, true);
    assert.equal(activity.audit.eventCount, 5);
    assert.throws(() => service.publishRelease(round.candidateHash, true, 'admin-private-credential', 'admin-private-credential', 'astra-private-credential', 'astra-private-credential'), /Separate human approval credential/);
    assert.equal(service.publishRelease(round.candidateHash, true, 'admin-private-credential', 'admin-private-credential', 'human-private-credential', 'human-private-credential').status, 'released');
    assert.equal(ledger.status().eventCount, 6);
    const bytes = await readFile(path, 'utf8');
    const runEvent = bytes.trim().split('\n').map(line => JSON.parse(line).event).find(event => event.type === 'run_recorded');
    const digest = value => createHash('sha256').update(value).digest('hex');
    assert.deepEqual(runEvent.proposalIdHashes, [digest('AUD-A'), digest('AUD-F')]);
    assert.equal(runEvent.source, 'manual');
    assert.equal(bytes.includes('12px'), false);
    assert.equal(bytes.includes('private proposal text'), false);
    assert.equal(bytes.includes('private-credential'), false);
    assert.equal(new AuditLedger(path).status().headHash, ledger.status().headHash);
    const edited = bytes.replace('proposal_created', 'proposal_deleted');
    await writeFile(path, edited);
    assert.throws(() => new AuditLedger(path), /audit integrity/i);
    await writeFile(path, bytes.replace('\n', '\n\n'));
    assert.throws(() => new AuditLedger(path), /audit integrity/i);
    await writeFile(path, bytes.replace('"hash":', '"extra":"unsigned", "hash":'));
    assert.throws(() => new AuditLedger(path), /audit integrity/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('audit write failure cannot acknowledge a proposal or approval', async () => {
  const bundle = await loadBundle();
  const fail = { record: () => { throw new Error('audit unavailable'); }, status: () => ({ durable: false, eventCount: 0, headHash: null }) };
  const service = new StyleService({ ...bundle, principles: {}, patterns: [], antiPatterns: {}, decisions: {} }, new Map(), { auditLedger: fail });
  const proposal = { id: 'FAIL-A', author: 'astra', baseVersion: '0.2.0', summary: 'x', changes: [{ path: 'tokens.radius.md.$value', value: '8px' }], tradeoffs: [], unresolved: [] };
  assert.throws(() => service.createProposal('FAIL-A', proposal, 'admin', 'admin'), /audit unavailable/);
  assert.equal(service.getProposal('FAIL-A'), undefined);
  const plain = new StyleService({ ...bundle, principles: {}, patterns: [], antiPatterns: {}, decisions: {} });
  assert.throws(() => plain.createProposal('FAIL-A', { ...proposal, author: 'other' }, 'admin', 'admin'), /Proposal author/);
});
