import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const projectRoot = resolve(import.meta.dirname, '..');
const packageRoot = join(projectRoot, 'packages', 'cli');
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const runNpm = (args, cwd) => spawnSync(
  process.platform === 'win32' ? process.execPath : 'npm',
  process.platform === 'win32' ? [npmCli, ...args] : args,
  { cwd, encoding: 'utf8' }
);

test('packed stylecon validates a clean consumer spec and reports a broken target', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'stylecon-consumer-'));
  try {
    const pack = runNpm(['pack', packageRoot, '--pack-destination', temp, '--json'], temp);
    assert.equal(pack.status, 0, pack.stderr);
    const [{ filename }] = JSON.parse(pack.stdout);
    const install = runNpm(['install', '--offline', '--ignore-scripts', join(temp, filename)], temp);
    assert.equal(install.status, 0, install.stderr);
    const installed = JSON.parse(await readFile(join(temp, 'node_modules', '@styleconstitution', 'cli', 'package.json'), 'utf8'));
    assert.equal(installed.bin.stylecon, 'dist/stylecon.mjs');
    const command = join(temp, 'node_modules', '@styleconstitution', 'cli', installed.bin.stylecon);
    const consumer = join(temp, 'consumer');
    await cp(join(projectRoot, 'spec'), join(consumer, 'spec'), { recursive: true });
    const clean = runNpm(['exec', '--offline', '--', 'stylecon', 'validate', '--root', consumer], temp);
    assert.equal(clean.status, 0, `${clean.stdout}\n${clean.stderr}`);
    assert.match(clean.stdout, /StyleSpec valid/);

    const buttonPath = join(consumer, 'spec', 'components', 'button.json');
    const button = JSON.parse(await readFile(buttonPath, 'utf8'));
    button.accessibility.minimumTarget = '24px';
    await writeFile(buttonPath, JSON.stringify(button));
    const invalid = spawnSync(process.execPath, [command, 'validate'], { cwd: consumer, encoding: 'utf8' });
    assert.equal(invalid.status, 1, `${invalid.stdout}\n${invalid.stderr}`);
    assert.match(invalid.stderr, /STYLE-A11Y-009.*components\.button\.accessibility\.minimumTarget/);

    const missing = spawnSync(process.execPath, [command, 'validate', '--root', join(temp, 'absent')], { cwd: temp, encoding: 'utf8' });
    assert.equal(missing.status, 2, `${missing.stdout}\n${missing.stderr}`);
    assert.match(missing.stderr, /Cannot read StyleSpec/);

    button.accessibility.minimumTarget = '40px';
    await writeFile(buttonPath, JSON.stringify(button));
    await writeFile(join(consumer, 'spec', 'tokens', 'unsafe.json'), '{"__proto__":{"styleconPolluted":"yes"}}');
    const unsafe = spawnSync(process.execPath, [command, 'validate'], { cwd: consumer, encoding: 'utf8' });
    assert.equal(unsafe.status, 2, `${unsafe.stdout}\n${unsafe.stderr}`);
    assert.match(unsafe.stderr, /Unsafe object key: __proto__/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
