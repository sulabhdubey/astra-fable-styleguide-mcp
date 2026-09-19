# TypeScript client

The workspace package `@styleconstitution/sdk` wraps the official MCP v2 HTTP client. It exposes only the eight public read and compliance tools. It negotiates the 2026 protocol when the server supports it and falls back to the SDK's legacy handshake for older servers. No provider API key is required for the public endpoint.

From a clone of this repository:

```bash
pnpm install
pnpm --filter @styleconstitution/sdk build
```

Then in a Node.js ESM script in the repository:

```ts
import { StyleConstitutionClient } from './packages/sdk/dist/index.js';

const client = new StyleConstitutionClient({
  endpoint: 'https://astra-fable-styleguide-mcp.vercel.app/mcp',
});

try {
  const manifest = await client.getStyleManifest();
  const button = await client.getComponentRules('button');
  const report = await client.checkStyleCompliance('.button { padding: 13px; }');
  console.log(manifest.version, button.id, report.compliant, report.violations);
} finally {
  await client.close();
}
```

Other methods: `health`, `listTools`, `getDesignTokens`, `searchStyleSpec`, `explainStyleDecision`, `validateTokens`, and `compareSpecVersions`. `callReadTool` rejects non-public names at runtime. The v0.2 compliance report adds `status`, source locations, and coverage fields; those fields are optional in the client type while the public v0.1.0 endpoint remains pinned. The package is currently private and consumed from a repository clone; no registry publication is claimed.

`protocolEra()` returns `modern` after the discovery handshake with the current server. Set `protocolMode: 'legacy'` in the constructor to test an older initialize-only server; it then returns `legacy` after connection. `PUBLIC_STYLE_TOOL_NAMES` exports the expected eight names for a strict client-side check. A client should still inspect the server's advertised tools before enabling them, and Cursor may require approval for each tool call.

To check a running endpoint from this clone after building the SDK:

```bash
node scripts/probe-mcp.mjs https://astra-fable-styleguide-mcp.vercel.app/mcp
```

The JSON result includes the negotiated protocol era, manifest version, advertised tool names, and `expectedToolNamesOnly`. The command exits nonzero if the advertised names differ from the eight public tools. This checks names, not server-side behavior. It sends only MCP discovery, tool listing, and `get_style_manifest` calls. The MCP URL is the discovery entry point; no separate metadata route is required.

The repository test starts its own local MCP server and exercises the client without an external AI call or network service.

On 2026-09-19, the probe connected to the pinned public v0.1.0 endpoint, negotiated `modern`, read version `0.1.0`, and found exactly the eight public tools. That live check did not exercise every wrapper against production.
