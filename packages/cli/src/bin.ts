import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { evaluateSpec } from '../../evaluator/src/index.js';
import { mergeObjects } from '../../style-spec/src/index.js';

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readDirectory(root: string, subdirectory: string): Promise<unknown[]> {
  const directory = join(root, 'spec', subdirectory);
  const files = (await readdir(directory)).filter(file => file.endsWith('.json')).sort();
  return Promise.all(files.map(file => readJson(join(directory, file))));
}

async function validate(root: string): Promise<number> {
  let manifest: unknown;
  let tokens: Record<string, unknown> = {};
  let components: unknown[];
  let accessibility: unknown;
  let patterns: unknown[];
  try {
    manifest = await readJson(join(root, 'spec', 'manifest.json'));
    await readJson(join(root, 'spec', 'principles.json'));
    for (const tokenFile of await readDirectory(root, 'tokens')) {
      if (typeof tokenFile !== 'object' || tokenFile === null || Array.isArray(tokenFile)) {
        throw new Error('Token file must contain a JSON object');
      }
      tokens = mergeObjects(tokens, tokenFile as Record<string, unknown>);
    }
    components = await readDirectory(root, 'components');
    accessibility = await readJson(join(root, 'spec', 'accessibility', 'rules.json'));
    patterns = await readDirectory(root, 'patterns');
  } catch (error) {
    console.error(`Cannot read StyleSpec at ${root}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const result = evaluateSpec({ manifest, tokens, components, accessibility, patterns });
  for (const issue of result.issues) {
    console.error(`${issue.severity.toUpperCase()} ${issue.code} ${issue.path}: ${issue.message}`);
  }
  if (!result.valid) {
    console.error(`StyleSpec invalid: ${result.metrics.errors} error(s), ${result.metrics.warnings} warning(s).`);
    return 1;
  }
  console.log(`StyleSpec valid: ${result.metrics.warnings} warning(s).`);
  return 0;
}

const args = process.argv.slice(2);
if (args[0] === 'validate' && (args.length === 1 || (args.length === 3 && args[1] === '--root' && !!args[2]))) {
  process.exitCode = await validate(resolve(args[2] ?? process.cwd()));
} else {
  console.error('Usage: stylecon validate [--root <directory>]');
  process.exitCode = 2;
}
