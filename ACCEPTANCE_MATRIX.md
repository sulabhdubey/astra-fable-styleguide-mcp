# v0.1.0 Candidate Acceptance Matrix

| Requirement | Status | Evidence |
|---|---|---|
| Core strict TypeScript compiles | PASS | `npm run typecheck` |
| Core test suite | PASS | 20/20 Node tests |
| Canonical StyleSpec validation | PASS | 0 errors, 0 warnings |
| Broken token references rejected | PASS | regression test |
| Circular token references rejected | PASS | regression test |
| Contrast violations detected | PASS | regression test |
| Component state/focus rules validated | PASS | deterministic evaluator |
| Independent first Astra/Fable proposals | PASS | consensus test |
| Bidirectional cross-review | PASS | consensus test |
| Bounded convergence/deadlock | PASS | consensus tests |
| Conflicting same-path changes blocked | PASS | service test |
| Exact SHA-256 approvals | PASS | governance tests |
| Candidate mutation invalidates approvals | PASS | governance test |
| Human release gate | PASS | separate human-held credential test + disabled-by-default release tool |
| One-call product brief → agent consensus → candidate | PASS | deterministic mock orchestration test |
| OpenAI/Anthropic HTTP adapter contracts | PASS | mocked HTTP contract tests; no external credits used |
| Generated JSON/CSS/TypeScript | PASS | generation pipeline |
| Generated artifact reproducibility | PASS | two consecutive generation/hash passes |
| Credential-pattern scan | PASS | repository audit |
| Docs read from `/spec` | PASS | Astro data loader + portable docs proof |
| Official MCP v2 adapter source/type shape | PASS | local compile against verified API shape |
| GitHub CI workflow exists | PASS | `.github/workflows/ci.yml` |
| GitHub Pages workflow exists | PASS | `.github/workflows/pages.yml` |
| Docker packaging exists | PASS | `Dockerfile` |
| Full installed MCP SDK runtime | PENDING EXTERNAL | npm registry unavailable in this container; CI runs `pnpm smoke:mcp` |
| Astro production build with installed package | PENDING EXTERNAL | npm registry unavailable; Pages/CI build it |
| Docker image build | PENDING EXTERNAL | Docker unavailable here; CI runs `docker build` |
| Live OpenAI/Anthropic provider call | PENDING CREDENTIALS | intentionally not run; requires user-owned API credentials |
| GitHub publication/Pages deployment | PENDING REPOSITORY | connected account has no target repo and connector cannot create repositories |

`candidate` is intentional: change the release state only after the connected CI and deployment gates are green.
