# Public MCP client trials

These observations are from **2026-09-19** against `https://astra-fable-styleguide-mcp.vercel.app/mcp` on the released `v0.1.0` service. They describe actual client calls, with limits called out below.

## Codex CLI coding-agent trial

Codex CLI `0.155.0-alpha.9.2` with `gpt-5.6-luna` connected to the public Streamable HTTP endpoint. In a temporary empty workspace, the agent called `get_style_manifest`, `get_design_tokens`, and `get_component_rules` for `button` before creating a responsive settings page in `index.html`. It used returned colors, spacing, semantic tokens, button variants, the 40px control target, and visible focus styling.

The first `check_style_compliance` call returned `compliant: false` and seven `STYLE-SPACE-001` findings for raw pixel spacing values. The agent revised the file to use token-derived expressions. The repeat live compliance call failed with a client HTTP transport error; `/health` returned `ok: true` and `version: 0.1.0` after that failure, but its cause was not established. A later independent check of the final file with the same release `StyleService` returned `compliant: true` with zero findings. This local result does not turn the failed live call into a successful one.

An initial CLI attempt with an approval policy of `never` could list MCP tools but could not call them: `MCP tool call requires approval`. A later bounded run using Codex's built-in approval mode completed the read calls and first compliance call. The temporary workspace began empty. The final static page was rendered in Edge at desktop and 390px mobile width; its form and navigation were visible at both sizes. This trial proves one real coding agent consumed the rules and reacted to deterministic findings; it does not prove that all generated UI is accessible or fully compliant.

## Cursor CLI coding-agent trial

Cursor CLI `2026.09.18-9a7762b` on a **Free** account connected to the same public endpoint in a separate temporary empty workspace. The server configuration used `.cursor/mcp.json` with the URL shown in the README. The CLI listed all eight tools. The first noninteractive run found the tools but each call was denied pending tool approval. In a continued run, a workspace `.cursor/cli.json` allowed only `get_style_manifest`, `get_design_tokens`, `get_component_rules`, and `check_style_compliance`, plus read/write access to the local example file; shell and other web access were denied. `--approve-mcps` completed the bounded MCP approval. This setup was limited to the temporary trial workspace.

The agent called all three read tools before creating a responsive settings page. Its first live compliance check returned three `STYLE-SPACE-001` findings (`720px`, `44px`, `3px`). It revised the file, and a second live call returned `compliant: true` with zero findings. An independent local check with the release `StyleService` also returned `compliant: true` with zero findings. The static page was rendered in Edge at desktop and 390px mobile width, with no visible horizontal overflow. Its updates switch toggled and Reset restored it; Save displayed a success message. This is a local example, not a deployed product or comprehensive accessibility audit.

The compliance tool currently checks a limited set of textual rules. Its passing result means those rules found no violations in the supplied source, not that every UI behavior, token, state, or accessibility requirement has been verified. These two trials establish that independent coding agents can consume the public MCP rules and use deterministic feedback to revise an example.

## Independent protocol client

The official MCP Inspector CLI connected with Streamable HTTP, listed **exactly eight** public tools, and called `get_style_manifest` successfully. It returned `version: 0.1.0` and `status: released`. Its `check_style_compliance` call on `padding:13px` returned `compliant: false` with `STYLE-SPACE-001` and a suggested semantic-token fix.

Reproduction commands:

```bash
npx --yes @modelcontextprotocol/inspector --cli https://astra-fable-styleguide-mcp.vercel.app/mcp --transport http --method tools/list --format json
npx --yes @modelcontextprotocol/inspector --cli https://astra-fable-styleguide-mcp.vercel.app/mcp --transport http --method tools/call --tool-name get_style_manifest --format json
npx --yes @modelcontextprotocol/inspector --cli https://astra-fable-styleguide-mcp.vercel.app/mcp --transport http --method tools/call --tool-name check_style_compliance --tool-arg input=padding:13px --format json
```

Inspector is a protocol test client, separate from the two coding-agent trials above.

## Follow-up for v0.2.0

1. Make onboarding clearer about client tool approvals and record retryable HTTP failures with enough detail to distinguish client, network, and server causes.
2. Expand compliance beyond obvious text patterns while keeping deterministic rule identifiers, test fixtures, and honest limitations.
3. Add repeatable browser and accessibility checks for generated examples before making stronger quality claims.
