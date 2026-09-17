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
