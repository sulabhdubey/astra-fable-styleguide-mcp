import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function privateFilePaths(paths) {
  return paths.filter(path => {
    const parts = path.replaceAll('\\', '/').split('/');
    const name = parts.at(-1).toLowerCase();
    return (name !== '.env.example' && (name === '.env' || name.startsWith('.env.')))
      || name === '.envrc' || parts.some(part => ['.vercel', '.rta-smriti'].includes(part.toLowerCase()))
      || /\.(?:key|p12|pfx|sqlite|sqlite3)(?:-(?:wal|shm))?$/i.test(name)
      || /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/.test(name);
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  // NUL-delimited paths avoid whitespace/newline ambiguity. Git failures are blocking.
  const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const denied = privateFilePaths(paths);
  if (denied.length) {
    console.error(`Blocked ${denied.length} tracked private file(s): ${JSON.stringify(denied)}`);
    process.exitCode = 1;
  } else console.log(`Tracked-file privacy gate passed (${paths.length} files). Templates still require content review.`);
}
