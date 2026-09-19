import { StyleConstitutionClient, PUBLIC_STYLE_TOOL_NAMES } from '../packages/sdk/dist/index.js';

const endpoint = process.argv[2];
let url;
try {
  url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
} catch {
  process.stderr.write('Usage: node scripts/probe-mcp.mjs <http(s)://host/mcp> (no URL credentials or query)\n');
  process.exitCode = 2;
}

if (url) {
  const client = new StyleConstitutionClient({ endpoint: url.href });
  try {
    const [listed, manifest] = await Promise.all([client.listTools(), client.getStyleManifest()]);
    const toolNames = listed.tools.map(tool => tool.name).sort();
    const expected = [...PUBLIC_STYLE_TOOL_NAMES].sort();
    const expectedToolNamesOnly = JSON.stringify(toolNames) === JSON.stringify(expected);
    process.stdout.write(`${JSON.stringify({
      endpoint: client.endpoint(),
      protocolEra: client.protocolEra(),
      version: manifest.version,
      toolNames,
      expectedToolNamesOnly,
    }, null, 2)}\n`);
    if (!expectedToolNamesOnly) process.exitCode = 1;
  } catch {
    process.stderr.write('MCP probe failed; inspect endpoint and network access.\n');
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}
