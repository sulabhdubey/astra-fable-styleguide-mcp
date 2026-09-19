# Public MCP client trials

These observations are from **2026-09-19** against `https://astra-fable-styleguide-mcp.vercel.app/mcp` on the released `v0.1.0` service. They describe actual client calls, with limits called out below.

## Codex CLI coding-agent trial

Codex CLI `0.155.0-alpha.9.2` with `gpt-5.6-luna` connected to the public Streamable HTTP endpoint. In a temporary empty workspace, the agent called `get_style_manifest`, `get_design_tokens`, and `get_component_rules` for `button` before creating a responsive settings page in `index.html`. It used returned colors, spacing, semantic tokens, button variants, the 40px control target, and visible focus styling.

The first `check_style_compliance` call returned `compliant: false` and seven `STYLE-SPACE-001` findings for raw pixel spacing values. The agent revised the file to use token-derived expressions. The repeat compliance call failed with a client HTTP transport error, so the final page has **no confirmed passing compliance result**. `/health` returned `ok: true` and `version: 0.1.0` after that failure; its cause was not established.

An initial CLI attempt with an approval policy of `never` could list MCP tools but could not call them: `MCP tool call requires approval`. A later bounded run using Codex's built-in approval mode completed the read calls and first compliance call. The temporary workspace began empty. This trial proves one real coding agent consumed the rules and reacted to deterministic findings; it does not prove that all generated UI is compliant or that approval setup is frictionless.

## Independent protocol client

The official MCP Inspector CLI connected with Streamable HTTP, listed **exactly eight** public tools, and called `get_style_manifest` successfully. It returned `version: 0.1.0` and `status: released`. Its `check_style_compliance` call on `padding:13px` returned `compliant: false` with `STYLE-SPACE-001` and a suggested semantic-token fix.

Reproduction commands:

```bash
npx --yes @modelcontextprotocol/inspector --cli https://astra-fable-styleguide-mcp.vercel.app/mcp --transport http --method tools/list --format json
npx --yes @modelcontextprotocol/inspector --cli https://astra-fable-styleguide-mcp.vercel.app/mcp --transport http --method tools/call --tool-name get_style_manifest --format json
npx --yes @modelcontextprotocol/inspector --cli https://astra-fable-styleguide-mcp.vercel.app/mcp --transport http --method tools/call --tool-name check_style_compliance --tool-arg input=padding:13px --format json
```

Inspector is a protocol test client, not a second coding agent. A second independent coding-agent workflow remains untested. The documented Cursor configuration has not been exercised on this machine because its installed shortcut does not point to a usable executable.

## Follow-up for v0.2.0

1. Run a second coding agent through the MCP connection and save its generated UI and compliance result.
2. Recheck the revised Codex page with the deterministic compliance tool, then inspect the rendered page on desktop and mobile. A transport error is not a pass.
3. Make onboarding clearer about client tool approvals and record retryable HTTP failures with enough detail to distinguish client, network, and server causes.
4. Expand compliance beyond obvious text patterns while keeping deterministic rule identifiers, test fixtures, and honest limitations.
