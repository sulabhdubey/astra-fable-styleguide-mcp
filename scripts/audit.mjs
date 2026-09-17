import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const required = [
  'GOAL.md','BUILD_SPEC.md','AGENTS.md','README.md','GOVERNANCE.md','SECURITY.md','Dockerfile',
  'apps/mcp-server/src/official-server.ts','apps/mcp-server/src/service.ts','apps/docs/src/pages/index.astro',
  '.github/workflows/ci.yml','.github/workflows/pages.yml','.github/workflows/release.yml',
  'generated/css/tokens.css','generated/json/style-spec.json','generated/typescript/tokens.ts'
];
let failures = [];
for (const path of required) { try { await stat(path); } catch { failures.push(`missing required file: ${path}`); } }

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{12,}/,
  /ghp_[A-Za-z0-9]{12,}/,
  /AKIA[0-9A-Z]{16}/
];
const ignored = new Set(['node_modules','dist','.git']);
async function walk(path) {
  const out=[];
  for (const entry of await readdir(path,{withFileTypes:true})) {
    if (ignored.has(entry.name)) continue;
    const full=join(path,entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}
for (const file of await walk('.')) {
  if (/\.(png|jpg|jpeg|gif|zip|gz)$/i.test(file)) continue;
  let text; try { text=await readFile(file,'utf8'); } catch { continue; }
  for (const p of secretPatterns) if (p.test(text)) failures.push(`possible credential pattern in ${file}`);
}

const componentFiles=(await readdir('spec/components')).filter(f=>f.endsWith('.json'));
if(componentFiles.length<8) failures.push(`expected at least 8 canonical components, found ${componentFiles.length}`);
const tokenFiles=(await readdir('spec/tokens')).filter(f=>f.endsWith('.json'));
if(tokenFiles.length<8) failures.push(`expected at least 8 token domain files, found ${tokenFiles.length}`);
const official=await readFile('apps/mcp-server/src/official-server.ts','utf8');
for(const needle of ['createMcpHandler','get_style_manifest','check_style_compliance','MCP_ENABLE_WRITES']) if(!official.includes(needle)) failures.push(`production MCP adapter missing ${needle}`);
if(failures.length){console.error(failures.join('\n'));process.exit(1);}console.log(JSON.stringify({ok:true,componentFiles:componentFiles.length,tokenFiles:tokenFiles.length,secretScan:'pass',requiredFiles:'pass'},null,2));
