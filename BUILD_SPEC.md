# Astra + Fable Style Constitution — Build Specification

## Objective
Build an open-source TypeScript monorepo in which logical agent roles **Astra** and **Fable** independently propose design-system changes, cross-critique, revise, pass deterministic evaluation, converge on the same candidate hash, and produce a governed candidate release. Human approval remains required by default.

## Required outputs
1. Canonical machine-readable StyleSpec under `/spec`.
2. Provider-independent Astra/Fable adapter interface plus deterministic mock agents.
3. Consensus engine with independent first proposals, cross-review, bounded rounds, explicit conflicts, SHA-256 candidate hashing, deadlock handling, and same-hash approvals.
4. Deterministic evaluator for schema basics, token references/cycles, contrast, component states/focus, and semantic-token discipline.
5. MCP v2 server targeting protocol revision `2026-07-28`, using the official TypeScript SDK and stateless HTTP handler.
6. Public read resources/tools; mutation/release logic protected and disabled by default for anonymous callers.
7. Human docs site derived from `/spec`.
8. Generated JSON, CSS variables, and TypeScript token artifacts.
9. CLI/validation scripts, tests, GitHub Actions, Pages workflow, Dockerfile, security/governance docs.

## Canonical model
`/spec` is authoritative. `/generated`, docs, MCP responses, and SDK outputs are derivative. Agents never directly overwrite `/spec`; they create proposals/candidates.

## Style domains
Principles, color, typography, spacing, sizing, radius, borders, elevation, motion, grid, breakpoints, icons, focus behavior, accessibility, content tone, interaction states, components, patterns, and anti-patterns.

## Consensus states
`CREATED → INDEPENDENT_PROPOSALS → CROSS_REVIEW → REVISION → DETERMINISTIC_EVALUATION → CONSENSUS | DEADLOCK | INVALID → CANDIDATE_READY → HUMAN_APPROVAL → RELEASED`.

Default maximum consensus rounds: **5**.

## Governance invariants
- First proposals are independent.
- Natural-language “agree” is insufficient.
- Approvals reference an exact SHA-256 candidate hash.
- Candidate mutation invalidates previous approvals.
- Deterministic tests arbitrate machine-testable questions.
- Human release approval is required by default.
- Public MCP is read-only by default.

## MCP resources
`style://manifest`, `style://principles`, `style://tokens`, `style://components`, `style://components/button`, `style://patterns`, `style://accessibility`, `style://anti-patterns`, `style://decisions`, `style://version`.

## MCP tools
Read: `get_style_manifest`, `get_design_tokens`, `get_component_rules`, `search_style_spec`, `explain_style_decision`, `validate_tokens`, `check_style_compliance`, `compare_spec_versions`.

Governed lifecycle: `create_style_proposal`, `evaluate_style_proposal`, `start_consensus_round`, `get_consensus_status`, `approve_candidate`, `publish_release`. Optional authenticated AI orchestration: `generate_style_constitution_candidate` runs the full independent proposal → cross-review → deterministic evaluation → bounded consensus path from one product brief.

## Acceptance criteria
- Core TypeScript compiles.
- Core tests pass.
- Canonical JSON validates under project validators.
- Broken and circular token references are rejected.
- Required contrast violations are detected.
- Interactive components must define required states and visible focus rules.
- First proposals are independent.
- Cross-review happens in both directions.
- Conflicting same-path changes cannot become consensus silently.
- Deadlocks terminate at configured max rounds.
- Same candidate hash is required for approvals.
- Candidate mutation invalidates prior approvals.
- Human release gate is enforced by default.
- Generated JSON/CSS/TS assets are reproducible from `/spec`.
- MCP production adapter uses official v2 SDK `createMcpHandler`.
- Docs are derived from `/spec`.
- CI, Pages workflow, and Docker packaging exist.
- Repository contains no credentials.
