import test from 'node:test';
import assert from 'node:assert/strict';
import { privateFilePaths } from '../scripts/check-secret-files.mjs';

test('blocks tracked environment files, local deployment state, private keys and databases', () => {
  const paths = ['.env', 'apps/docs/.env.local', '.env.production', '.envrc', '.vercel/project.json',
    'apps/demo/.rta-smriti/state.json', 'keys/service.key', 'keys/id_ed25519', 'state.sqlite', 'data.sqlite3'];
  assert.deepEqual(privateFilePaths(paths), paths);
});

test('allows reviewed environment templates and normal product files', () => {
  assert.deepEqual(privateFilePaths(['.env.example', 'apps/demo/.env.example',
    'README.md', 'spec/tokens/colors.json', 'src/environment.ts']), []);
});
