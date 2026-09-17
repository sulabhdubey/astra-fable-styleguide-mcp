# Verification status

## Executed successfully in this build environment

- Structural/security lint.
- Core TypeScript strict typecheck.
- 20 Node tests covering token compilation, StyleSpec validation, compliance checking, proposal authorization, governed proposal lifecycle, one-call agent orchestration, provider HTTP adapter contracts, deterministic candidate-path rejection, proposal independence, bidirectional cross-review, convergence, deadlock termination, same-hash approvals, human release gating, mutation invalidation, token cycles/references, and contrast math.
- Canonical StyleSpec validation: 0 errors, 0 warnings.
- Portable documentation build.
- Generated JSON/CSS/TypeScript artifact generation.
- Repeated-generation SHA-256 reproducibility check.
- Credential-pattern scan.
- Production MCP adapter syntax/type-shape check against the current official v2 API shape documented for `createMcpHandler`, `toNodeHandler`, `registerTool`, and `registerResource`.

## Requires a connected package/Docker environment

The execution container cannot reach the npm registry and does not provide Docker. Therefore these final integration checks are encoded in GitHub Actions but cannot honestly be reported as executed here:

- install `@modelcontextprotocol/server`, `@modelcontextprotocol/node`, Zod, Astro, ESLint;
- full dependency-aware TypeScript check;
- actual MCP v2 SDK runtime smoke test;
- Astro production build;
- Docker image build/run.

Run `pnpm verify` in a connected environment. CI is configured to run the dependency-aware checks on every push/PR.
