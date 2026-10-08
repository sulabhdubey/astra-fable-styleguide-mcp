# Individual and team workflows

These workflows are included in the v0.9.0 CLI archive. Use the installer and checksums from that release.

## An individual builder: finding → agent brief → recheck

1. Start [Local Studio](LOCAL_STUDIO.md) and select a trusted, supported project.
2. Run checks. Inspect the element, observed value, expected rule and coverage.
3. Select **Include in brief** beside each finding you want to address. Choose
   **Prepare selected findings** and review the text before copying it.
4. Give the reviewed brief to your existing coding agent. Inspect its proposed
   source changes. For Vite, rebuild your trusted project before checking again.
5. Run the same checks and inspect the result. A copied brief is historical
   guidance and does not authorize edits or establish that a repair works.

This works for observation-only findings as well as mapped repairs. The brief
contains selected facts, relative source labels, configuration/source/rule
hashes, total coverage counts, omissions and recheck guidance. It excludes
repair receipts and source bodies. Project text can still be private: automatic
field filtering is not a guarantee that it is safe to share. Studio makes no AI
call. Your coding client may have its own account and costs.

The CLI supports the same brief builder:

```sh
stylecon check /absolute/project --format json --output /private/before.json
stylecon brief /absolute/project /private/before.json --list
stylecon brief /absolute/project /private/before.json --select <finding-id> --output /private/brief.txt
```

Use comma-separated IDs for several findings. Omit `--output` to inspect the
brief in the terminal. The output path must be new and outside the checked
project. Both Studio and CLI reject changed source, build, configuration or
constitution before preparing a brief. Copying in Studio checks those bindings
again. This is file freshness, not another browser observation.

## A team evaluator: reviewed rules and private history

In **Create rules**, review and export a constitution. In **Check & correct →
Use your team's rules**:

1. Enter a new snapshot path inside the selected project.
2. Expand **Create a snapshot from canonical rules**, choose the exported rules
   repository relative to the workspace, and create the snapshot. Existing files
   cannot be overwritten.
3. Choose **Review rule adoption**. Inspect the old and proposed identities,
   checked-rule values, configuration pin and approval hash.
4. Adopt the reviewed hash. Any changed source, build, configuration or snapshot
   invalidates it. Adoption changes only the project's pin; it leaves `/spec`
   and the snapshot unchanged. Run checks again.

Adoption needs the private evidence directory on the same filesystem as the
project. Its recovery journal and backups are stored there, outside the project.
After an interrupted adoption, Studio shows **Recover pending adoption** and
requires recovery before new checks or configuration changes. Recovery refuses
to replace conflicting external configuration edits. Keep those bytes and the
private journal for inspection if recovery reports a conflict.

**Previous checks & comparison** persists across Studio restarts. Opening a run
labels it historical and does not restore repair or brief authority. Comparison
requires the same configuration, constitution, source labels and recorded check
coverage. It distinguishes new, existing, resolved and incomplete findings;
previous failures that become incomplete stay unresolved. Changed rules or
removed checks cannot turn an old failure into a claimed resolution.

History is bound to the canonical workspace and project paths. Moving a
workspace creates a different history namespace. Missing or altered record files
are unavailable. Checksums detect changes; a person able to rewrite both data
and checksums can forge them. These are not signed audit records. If both files
for a run are removed, that run cannot be enumerated.

Each project has a 100-run storage limit with no automatic deletion. At that
limit, retain the old evidence and restart Studio with another private evidence
directory. Comparisons work within a directory; moving or importing history is
not supported. Reports are capped at 2 MB. Local filesystem access controls,
backups and retention remain the operator's responsibility.

## An enterprise evaluation fits your existing review process

For a designer, client or teammate who does not use the CLI, prepare an
[offline review packet](REVIEW_PACKETS.md) in Studio. Review its limited disclosure
before downloading. Every recorded outcome is included, while private target
names and free-form diagnostics are omitted. Explain the page and numbered
elements to the recipient through your existing review process.

Use the [Git-bound PR evidence workflow](PR_REGRESSIONS.md) in advisory mode on
one supported component first. Keep repository permissions, reviewer identity,
policy approval and release decisions in your existing Git/CI system. Compare
reports with your current tests and record incomplete coverage and review effort.

Studio supplies local checking, reviewed rule adoption and scoped evidence.
It does not supply hosted tenancy, SSO, RBAC, compliance certification, signed
attestations or an SLA. Internal fixtures establish the tested behavior, not
customer adoption, willingness to pay, enterprise security approval or savings.
