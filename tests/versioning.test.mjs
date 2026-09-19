import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compareSnapshots, verifySnapshot } from '../dist/packages/versioning/src/index.js';

test('released v0.1 snapshot is tied to exact bytes and commit', async () => {
  const { releases } = JSON.parse(await readFile('releases/manifest.json', 'utf8'));
  const entry = releases.find(item => item.version === '0.1.0');
  assert.equal(entry.sourceCommit, '4874c7d3b338c69b48435509be122bab495263b6');
  const bytes = await readFile(`releases/${entry.path}`);
  const snapshot = verifySnapshot(entry, bytes);
  assert.equal(snapshot.version, '0.1.0');
  assert.equal(Object.keys(snapshot.files).length, 25);
  assert.equal(verifySnapshot(entry, Buffer.from(bytes.toString().replace(/\r?\n/g, '\r\n'))).version, '0.1.0');
  const tampered = Buffer.from(bytes);
  tampered[tampered.length - 2] ^= 1;
  assert.throws(() => verifySnapshot(entry, tampered), /hash mismatch/);
});

test('version comparison reports stable domain changes and bounds output', async () => {
  const { releases } = JSON.parse(await readFile('releases/manifest.json', 'utf8'));
  const entry = releases.find(item => item.version === '0.1.0');
  const old = verifySnapshot(entry, await readFile(`releases/${entry.path}`));
  const next = JSON.parse(JSON.stringify(old));
  next.version = '0.2.0';
  next.files['manifest.json'].version = '0.2.0';
  next.files['tokens/primitive.json'].space['1'].$value = '5px';
  next.files['components/button.json'].states.push('loading');
  const result = compareSnapshots(old, next);
  assert.equal(result.totalChanges, 3);
  assert.equal(result.summaryByDomain.tokens, 1);
  assert.equal(result.summaryByDomain.components, 1);
  assert.ok(result.changes.some(change => change.path.includes('tokens/primitive.json#/space/1/$value') && change.before === '4px' && change.after === '5px'));
  assert.equal(compareSnapshots(old, next, 1).truncated, true);
  assert.equal(compareSnapshots(old, JSON.parse(JSON.stringify(old))).totalChanges, 0);
});
