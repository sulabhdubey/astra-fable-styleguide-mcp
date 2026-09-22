import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { injectDefect } from './ui-fixtures.mjs';
import { createContract } from '../packages/browser-verification/src/index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = { settings: 'examples/settings/index.html', codex: 'tests/fixtures/agent-trial-codex-luna.html', grok: 'tests/fixtures/agent-trial-grok-46.html' };
const json = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
export async function startUiLab(port = 4178) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
      const fixture = url.searchParams.get('case') ?? 'settings';
      if (!Object.hasOwn(fixtures, fixture)) throw new Error('Unknown case');
      const css = await readFile(resolve(root, 'generated/css/tokens.css'), 'utf8');
      const source = await readFile(resolve(root, fixtures[fixture]), 'utf8');
      const html = injectDefect(source.replaceAll('../../generated/css/tokens.css', '/tokens.css'), url.searchParams.get('defect') ?? '');
      const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
      if (url.pathname === '/tokens.css') { response.writeHead(200, { ...headers, 'Content-Type': 'text/css' }); response.end(css); }
      else if (url.pathname === '/case.json') {
        const [button, dialog, rules] = await Promise.all(['spec/components/button.json', 'spec/components/dialog.json', 'spec/accessibility/rules.json'].map(json));
        response.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ contract: createContract({ button, dialog, rules }), artifactSha256: createHash('sha256').update(JSON.stringify({ html, css })).digest('hex'), artifactHashScope: 'JSON.stringify({html,css}) served bytes', fixture }));
      } else if (url.pathname === '/') { response.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); }
      else { response.writeHead(404); response.end('Not found'); }
    } catch { response.writeHead(400); response.end('Invalid fixture request'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startUiLab(Number(process.env.PORT ?? 4178));
  console.log(`UI lab listening on http://127.0.0.1:${server.address().port}`);
}
