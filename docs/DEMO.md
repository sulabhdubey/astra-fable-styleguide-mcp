# Replay one measured repair

This is a synthetic internal rehearsal, not an external developer trial. A copy
of the profile example contains one intentional defect: its Review name button
is 24px high while the canonical product rule requires at least 40px. This is a
Style Constitution rule, not a claim that WCAG requires a 40px target.

## Prepare a private workspace

After installing and building the repository, choose a **new absolute directory**
whose parent already exists. Examples: `/tmp/style-demo` or `C:/Temp/style-demo`.
The command refuses an existing directory.

```sh
pnpm stylecon demo /absolute/new-demo
pnpm stylecon check /absolute/new-demo/project --format json --output /absolute/new-demo/evidence/before.json
```

Use the paths printed by `stylecon demo`. The checker starts and closes its own
loopback server and isolated Chromium instance. The workspace holds
`project/`, private `evidence/`, and the prepared `change.json` correction.

## Observe the defect

The first check above intentionally exits **1**. Read `before.json`; do not hide
that exit code in CI. Windows paths can use `C:/...`. The browser uses synthetic
input on the disposable copy. To inspect the page yourself, use
`pnpm project serve /absolute/new-demo/project/project.json 4182` and open the
printed local URL. The optional connected-tab API remains documented in
[configuration and connected-browser guide](https://github.com/sulabhdubey/astra-fable-styleguide-mcp/blob/main/docs/PROJECT_WORKFLOW.md).

Expected: a `target` failure for `#review`, rule `STYLE-A11Y-009`, with measured
height near 24px and minimum 40. Check the actual report rather than assuming it
contains only that finding on every browser.

## Review and apply

```sh
pnpm stylecon packet /absolute/new-demo/project/project.json /absolute/new-demo/evidence/before.json /absolute/new-demo/evidence/repair.json
pnpm stylecon repair preview /absolute/new-demo/project/project.json /absolute/new-demo/evidence/repair.json /absolute/new-demo/change.json
pnpm stylecon repair apply /absolute/new-demo/project/project.json /absolute/new-demo/evidence/repair.json /absolute/new-demo/change.json /absolute/new-demo/evidence
pnpm stylecon check /absolute/new-demo/project --format json --output /absolute/new-demo/evidence/after.json
```

Inspect the exact removed/inserted text before applying. The correction replaces
the fixed 24px height with canonical size and spacing tokens. Apply saves a private
receipt containing original source; a successful write is not a browser pass.

Check `after.json` to confirm the target finding is resolved, inspect the rendered result, and review any
remaining findings. Reusing the old repair packet must be rejected as stale.

Optional recovery uses the receipt path returned by apply:

```sh
pnpm stylecon repair undo /absolute/new-demo/project/project.json /absolute/new-demo/evidence/repair-ID.json /absolute/new-demo/evidence
```

Undo requires the current entire snapshot to match the repaired state; it restores
the original defect. Recheck after undo. Never overwrite reports to make a replay
look successful: use a new workspace or fresh output filenames.

## What this demonstrates

Observed defect → exact-source finding → reviewable correction → guarded edit →
rendered recheck. It demonstrates one bounded workflow. It does not establish
general repair accuracy, time savings, screen-reader behavior or customer adoption.
