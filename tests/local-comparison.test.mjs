import test from 'node:test';
import assert from 'node:assert/strict';
import { briefErrors } from '../scripts/compare-local-design.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('comparison oracle rejects no-op, unrelated paths, invalid units and excess changes', () => {
  const c = value => ({ changes: [{ path: 'tokens.radius.md.$value', value }] });
  assert.deepEqual(briefErrors(c('12px'), '8px'), []);
  for (const value of ['8px', '24px', '1rem', null]) assert.ok(briefErrors(c(value), '8px').length);
  assert.ok(briefErrors({changes:[{path:'tokens.color.blue.$value',value:'12px'}]},'8px').length);
  assert.ok(briefErrors({changes:[]},'8px').length);
});
test('an existing comparison receipt is rejected before inference starts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'design-receipt-'));
  const path = join(dir, 'existing.json');
  try {
    await writeFile(path, 'preserved');
    assert.throws(() => execFileSync(process.execPath, ['scripts/compare-local-design.mjs', path], {stdio:'pipe'}), /EEXIST/);
    assert.equal(await readFile(path, 'utf8'), 'preserved');
  } finally { await unlink(path); await rmdir(dir); }
});
