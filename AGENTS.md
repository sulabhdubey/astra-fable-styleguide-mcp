# AGENTS.md

## Mission
Build and maintain the system in `BUILD_SPEC.md`. Read `GOAL.md` and `BUILD_SPEC.md` before architectural changes.

## Invariants
- `/spec` is the only canonical design source.
- Astra and Fable are logical roles, never hardcoded vendors.
- Initial proposals must be generated independently.
- Prefer deterministic tests over model judgment.
- Consensus approvals must reference the exact candidate SHA-256.
- Any candidate mutation invalidates prior approvals.
- Agents may propose, critique, revise, evaluate, and agree; they may not silently publish.
- External AI calls are never required for CI; deterministic mocks must cover the full lifecycle.
- Do not put secrets in source, fixtures, logs, docs, or examples.

## Completion checks
Run all available verification. In a connected development environment the final gate is:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm validate
pnpm build
```

Never claim a command passed unless it was executed.
