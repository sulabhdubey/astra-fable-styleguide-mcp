import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
const fixture = mkdtempSync(join(tmpdir(), 'stylecon-secret-gate-'));
const invoke = (command, args) => spawnSync(command, args, { cwd: fixture, encoding: 'utf8' });
const git = (...args) => {
  const result = invoke('git', args);
  assert.equal(result.status, 0, `fixture git operation failed: ${result.error?.message ?? result.stderr}`);
};
const scan = () => invoke('gitleaks', ['git', '.', '--log-opts=--all --full-history -m',
  `--config=${join(root, '.gitleaks.toml')}`, `--gitleaks-ignore-path=${join(root, '.gitleaksignore')}`,
  '--ignore-gitleaks-allow', '--redact=100', '--no-banner', '--no-color', '--exit-code=1',
  '--report-format=json', `--report-path=${join(fixture, 'scan.json')}`]);
try {
  git('init', '--quiet');
  git('config', 'user.name', 'Security fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(fixture, 'README.md'), 'Synthetic security control; no real credentials.\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'Clean control');
  assert.equal(scan().status, 0, 'clean control or scanner execution failed');
  rmSync(join(fixture, 'scan.json'), { force: true });

  // Deliberately generated locally, never a real issued credential or committed to this project.
  const synthetic = ['gh', 'p_'].join('') + randomBytes(20).toString('hex');
  mkdirSync(join(fixture, 'releases'));
  writeFileSync(join(fixture, 'releases', '0.1.0-build-evidence.json'), JSON.stringify({ token: synthetic }));
  writeFileSync(join(fixture, 'config.txt'), `token=${synthetic} # gitleaks:allow\n`);
  git('add', '.'); git('commit', '--quiet', '-m', 'Seed rejection controls');
  const rejected = scan();
  assert.equal(rejected.status, 1, 'seeded credential must be rejected');
  const reportText = readFileSync(join(fixture, 'scan.json'), 'utf8');
  const findings = JSON.parse(reportText);
  const output = rejected.stdout + rejected.stderr + reportText;
  assert.ok(findings.some(f => f.File.replaceAll('\\', '/') === 'releases/0.1.0-build-evidence.json'), 'historical filename must not be broadly ignored');
  assert.ok(findings.some(f => f.File === 'config.txt'), 'inline suppression must not bypass the gate');
  assert.ok(!output.includes(synthetic), 'scanner output must redact credential bytes');

  writeFileSync(join(fixture, '.env'), 'UNRECOGNIZED_CREDENTIAL=fixture\n');
  git('add', '--force', '.env');
  const privateFile = invoke(process.execPath, [join(root, 'scripts', 'check-secret-files.mjs')]);
  assert.equal(privateFile.status, 1, 'tracked .env must fail even without a recognizable secret pattern');
  assert.ok(privateFile.stderr.includes('tracked private file'));
  console.log('Secret gate controls passed: clean history; seeded secret; inline bypass; same-file exclusion; redaction; tracked .env.');
} finally {
  // The only recursive removal targets this freshly created temp fixture.
  rmSync(fixture, { recursive: true, force: true });
}
