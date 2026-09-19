# Governance

The project separates **proposal authority** from **release authority**.

- Agents may create and evaluate proposals.
- Deterministic validators may reject invalid candidates.
- Two-agent agreement is recorded against an exact candidate hash.
- Default configuration requires explicit human release approval.
- Anonymous MCP consumers receive read-only capabilities.
- Published releases follow semantic versioning and include decision/test evidence.

## Release credential separation

The optional MCP `publish_release` tool is disabled unless `MCP_ENABLE_RELEASE_TOOL=true`. When enabled it requires both the MCP admin bearer credential and a separate `X-Human-Approval-Token` matching `MCP_RELEASE_APPROVAL_TOKEN`. The human approval credential must differ from the admin and configured role credentials. The GitHub release workflow additionally targets the protected `release-approval` environment.

## v0.2 development operator visibility

When `MCP_ENABLE_WRITES=true`, `get_governance_activity` gives an authorized operator the latest proposal identifiers and change paths, the latest 50 consensus-run summaries, conflicts, evaluation-error counts, candidate hashes, recorded role approvals, and whether both role approvals are present. `get_consensus_status` now requires the same admin bearer credential and reports readiness for an exact candidate hash. The public deployment still exposes only the eight read tools.

This is a **process-local prototype**. The service does not restore proposals, runs, candidates, or approvals after restart, and it does not coordinate multiple instances. By default, the admin bearer credential can still record either role's approval. Role labels alone do not prove two distinct authenticated people or agents. `publish_release` marks in-memory state only; an actual release still follows the separately approved GitHub workflow.

For a single trusted local instance, set `MCP_AUDIT_PATH` to a writable JSONL file outside the repository. Startup creates or verifies the file. Each acknowledged proposal, consensus run, role approval, and release marking is appended and flushed before the in-memory state changes. On startup, the server verifies sequence numbers and a SHA-256 hash chain; corrupt or partial records stop startup. The file stores hashes of proposal IDs, counts, status codes, candidate hashes, and role labels. It excludes proposal values, free-text summaries, provider responses, and credentials. `get_governance_activity.audit` reports its event count and head hash separately from `durable:false`, which describes the still-volatile workflow state. The chain detects unintentional edits, but removing complete tail records can leave a valid chain, and a writer can recompute an unkeyed chain. Keep the path on trusted storage and anchor its head hash in release evidence. This local option does not supply backup, cross-instance locking, or state replay.

Set both `MCP_ASTRA_APPROVAL_TOKEN` and `MCP_FABLE_APPROVAL_TOKEN` to distinct secrets to require an `X-Role-Approval-Token` header for the corresponding `approve_candidate` call, in addition to the admin bearer credential. Setting only one fails startup. This identifies which configured role credential authorized the call, not a human or model identity. Keep the credentials separate from `MCP_ADMIN_TOKEN` and `MCP_RELEASE_APPROVAL_TOKEN`. The public deployment sets `MCP_ENABLE_WRITES=false`, so none of these local controls exposes public mutation tools. A multi-user release workflow still needs durable state/replay rules and stronger identity before it can be called mature.

## Candidate additions

Authenticated proposal rounds may now add a complete token leaf under an existing token group and add a component token mapping under an existing component's `tokens` object. The mapping must be a token reference, and the merged candidate must pass the full deterministic validator before it receives a hash. Missing parents, unsafe or malformed paths, incomplete token leaves, and invalid references are rejected. Candidate creation does not edit `/spec`; canonical changes require a separate reviewed commit. The optional local provider adapter currently constrains its generated changes to existing paths, so new-path proposals use the authenticated proposal workflow until that adapter supports additions safely.
