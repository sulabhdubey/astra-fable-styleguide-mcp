# Governance

The project separates **proposal authority** from **release authority**.

- Agents may create and evaluate proposals.
- Deterministic validators may reject invalid candidates.
- Two-agent agreement is recorded against an exact candidate hash.
- Default configuration requires explicit human release approval.
- Anonymous MCP consumers receive read-only capabilities.
- Published releases follow semantic versioning and include decision/test evidence.

## Release credential separation

The optional MCP `publish_release` tool is disabled unless `MCP_ENABLE_RELEASE_TOOL=true`. When enabled it requires both the MCP admin bearer credential and a separate `X-Human-Approval-Token` matching `MCP_RELEASE_APPROVAL_TOKEN`. The GitHub release workflow additionally targets the protected `release-approval` environment.

## v0.2 development operator visibility

When `MCP_ENABLE_WRITES=true`, `get_governance_activity` gives an authorized operator the latest proposal identifiers and change paths, the latest 50 consensus-run summaries, conflicts, evaluation-error counts, candidate hashes, recorded role approvals, and whether both role approvals are present. `get_consensus_status` now requires the same admin bearer credential and reports readiness for an exact candidate hash. The public deployment still exposes only the eight read tools.

This is a **process-local prototype**. The service does not persist proposals, runs, candidates, or approvals across a restart or across instances. Run summaries omit proposal values and raw provider errors; they are not a durable audit log. The current admin bearer credential can record either role's approval, so the role labels do not prove two distinct authenticated people or agents. `publish_release` marks in-memory state only; an actual release still follows the separately approved GitHub workflow. Durable records, per-role identity, and replay/recovery rules must be designed and tested before claiming a multi-user governance system.
