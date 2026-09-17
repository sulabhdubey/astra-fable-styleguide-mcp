# Astra + Fable Style Constitution

**Two independent design agents. One governed design standard. Available to humans and machines through MCP.**

![Architecture](./architecture.png)

Astra + Fable Style Constitution turns design rules into a versioned, machine-readable contract. Two provider-independent agent roles propose and critique changes; deterministic checks resolve measurable questions; exact candidate hashes prevent fake consensus; humans retain release authority by default.

## What it gives you
- A canonical StyleSpec under `/spec`.
- Independent Astra/Fable proposal and cross-review workflow, including an optional one-call product-brief-to-candidate path.
- Deterministic token, accessibility, component, and governance checks.
- MCP resources and tools for coding agents.
- Generated CSS, JSON, and TypeScript artifacts.
- A human documentation site.
- Audit-friendly decisions and proposal records.

## Quick verification without external dependencies
The repository includes a dependency-light verification path for the core engine:

```bash
npm run verify:core
```

The full connected build uses pnpm and installs the official MCP SDK, Astro, Zod, ESLint, and TypeScript:

```bash
pnpm install
pnpm verify
```

## Production MCP
The production adapter targets MCP `2026-07-28` via the official v2 TypeScript packages and `createMcpHandler`. The public endpoint is read-oriented by default. Write/release workflows remain governance-gated. When explicitly enabled, `generate_style_constitution_candidate` can invoke configurable OpenAI/Anthropic-backed roles from a product brief; generated candidates still require exact-hash approvals. The optional release tool is separately disabled by default and requires a distinct human-held approval credential.

## Project contract
- Goal: [`GOAL.md`](./GOAL.md)
- Build requirements: [`BUILD_SPEC.md`](./BUILD_SPEC.md)
- Agent rules: [`AGENTS.md`](./AGENTS.md)
- Governance: [`GOVERNANCE.md`](./GOVERNANCE.md)
