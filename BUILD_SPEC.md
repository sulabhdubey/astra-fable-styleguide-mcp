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
`CREATED → INDEPENDENT_PROPOSALS → CROSS_REVIEW → REVISION → DETERMINISTIC_EVALUATION → CONSENSUS | NEEDS_CLARIFICATION | DEADLOCK | INVALID → CANDIDATE_READY → HUMAN_APPROVAL → RELEASED`.

Default maximum consensus rounds: **5**.

A round reviews the exact candidate before deciding whether revision is needed.
Both roles review a conflict-free merged candidate in full; conflicting proposals
retain both alternatives. Accepted valid candidates stop without forced revision.
Any revision requires a later review round. Reviewer identity, proposal ID and
candidate SHA-256 must match; earlier unresolved issues remain visible until
both reviewers explicitly resolve them on the candidate or defer the same issue
to the same caller-declared pending check. Deferred concerns remain open and
unverified; specification consensus does not complete them. Unknown check IDs,
conflicting dispositions, stale hashes and missing issue coverage fail closed.
Deterministic errors and specification objections still block consensus, and
pending implementation checks block the service release operation. Model review does not
replace deterministic checks, separate role approvals or human release authority.

Callers may declare immutable issue IDs and text in `reviewScope.issues`. These
definitions participate in the candidate hash and are retained by the host even
when a proposal omits them. Model explanations belong in `issueNotes`, referencing
an existing issue ID. Exact duplicate notes collapse; different explanations and
additional free-text concerns remain separate. No semantic deduplication or issue
resolution is inferred. Structured reviews use stable caller issue keys; existing
string-only inputs remain supported. Direct review rejects omitted caller concerns.

A structured clarification request with distinct quotes from the supplied brief,
criteria or deterministic validation errors stops revisions after the current
review. The result preserves candidate hashes, conflicts and the decision needed.
The request is an unverified reviewer judgment, not proof of a contradiction.
Only `CONSENSUS` can register a candidate. The service reuses an unchanged held
context without further model calls; changed requirements require new independent
proposals and reviews. Held hashes cannot be approved or manually promoted, and
successful re-evaluation never restores older role approvals. Write-enabled MCP
requires an explicitly initialized persistent clarification journal. Holds and
cached evidence survive restart; missing, corrupt or externally changed storage
fails closed. Candidate and approval registries remain process-local.

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
