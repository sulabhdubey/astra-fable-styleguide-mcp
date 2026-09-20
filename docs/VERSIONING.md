# Immutable StyleSpec snapshots

`/spec` is the only canonical design source. The files under `/releases` are historical copies for comparison, never an editing surface. The v0.1.0 snapshot contains all 25 JSON files from the exact `v0.1.0` Git tag at commit `4874c7d3b338c69b48435509be122bab495263b6`. The v0.2.0 and v0.3.0 snapshots also contain all 25 JSON files from their recorded release-preparation commits. `releases/manifest.json` records each snapshot file, its SHA-256, and source commit. A snapshot prepared on a branch is not a published release.

At startup the MCP server verifies each snapshot's SHA-256 over LF-normalized text and its manifest version. Git keeps snapshot files byte-stable in new checkouts; normalization also supports existing Windows checkouts created before that Git attribute was added. If the current `/spec` still declares a released version but differs from that version's snapshot, startup fails and requires a version bump. A corrupt or missing snapshot also prevents startup.

`compare_spec_versions` compares two known snapshots by canonical file path. It reports added, removed, and changed values, groups counts by domain, and identifies array entries by stable `id` where available. Results are deterministic and capped at 500 detailed changes; `totalChanges` and `truncated` retain the full count. The tool returns `availableVersions` when a requested version is not present. The `0.1.0 → 0.2.0` comparison reports the governed input-error design changes; the `0.2.0 → 0.3.0` comparison reports button and dialog rules as well as manifest metadata changes.

To capture a future candidate from a reviewed Git commit, run:

```bash
node scripts/capture-style-snapshot.mjs <commit-sha>
```

The script refuses to overwrite an existing version and only reads `/spec` from the named Git ref. Review the resulting snapshot, hash, source commit, and diff before committing it. Capturing a snapshot does not grant consensus approval or publish a release.
