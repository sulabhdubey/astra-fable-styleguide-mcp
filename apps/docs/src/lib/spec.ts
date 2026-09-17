import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '../..');
const specRoot = resolve(repoRoot, 'spec');
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

export const manifest = readJson<any>(resolve(specRoot, 'manifest.json'));
export const principles = readJson<any>(resolve(specRoot, 'principles.json'));
export const accessibility = readJson<any>(resolve(specRoot, 'accessibility/rules.json'));
export const antiPatterns = readJson<any>(resolve(specRoot, 'anti-patterns/common.json'));
export const components = readdirSync(resolve(specRoot, 'components'))
  .filter(name => name.endsWith('.json'))
  .sort()
  .map(name => readJson<any>(resolve(specRoot, 'components', name)));
export const tokenDocuments = readdirSync(resolve(specRoot, 'tokens'))
  .filter(name => name.endsWith('.json'))
  .sort()
  .map(name => ({ name, data: readJson<any>(resolve(specRoot, 'tokens', name)) }));
export const patterns = readdirSync(resolve(specRoot, 'patterns'))
  .filter(name => name.endsWith('.json'))
  .sort()
  .map(name => readJson<any>(resolve(specRoot, 'patterns', name)));
export const decisions = readdirSync(resolve(repoRoot, 'decisions'))
  .filter(name => name.endsWith('.md'))
  .sort()
  .map(name => ({ name, text: readFileSync(resolve(repoRoot, 'decisions', name), 'utf8') }));
