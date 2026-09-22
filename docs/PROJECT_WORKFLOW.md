# Configured check and repair workflow (experimental)

This local workflow connects a coding agent to rendered findings and guarded
source edits. It supports static HTML/CSS/JavaScript projects with light-DOM ID
targets. It does not bundle arbitrary frameworks or certify accessibility.

## Project configuration

See `examples/settings/project.json` and `examples/profile/project.json`.
Each configuration lives inside its project root and declares:

- `schemaVersion: 1` and an explicit `files` allowlist containing `index.html`.
- A button/dialog `journey` with ID selectors, expected accessible name and close action.
- `targetPaths` mapping every checked target, `dialog` and `page` to an allowed source file.
- Optional `form`, declared disabled/loading `states`, and additional dialog `closePaths`.

File paths are relative, limited to HTML/CSS/JS, and cannot traverse directories
or alias other files through symlinks. Unknown configuration fields are rejected.
The server supplies `/tokens.css` from the canonical generated assets; that route
cannot be overridden. Source files and configuration are limited in size.

```sh
pnpm project validate examples/settings/project.json
pnpm project serve examples/settings/project.json 4180
```

The preview listens on `127.0.0.1`. Only declared assets and `/_verification`
metadata are served. Writes, foreign Host/Origin headers, and cross-site requests
are rejected. CSP allows inline scripts/styles for these static fixtures, while
blocking network fetches, form navigation and embedding. This is a development
server for trusted local projects, not a sandbox for hostile JavaScript.

## Agent workflow

1. Inspect the project, configure synthetic test inputs, and start its preview.
2. Through the CUA environment, call `verifyProject(tab, origin)` from
   `scripts/verify-project.mjs`. It loads the page before interacting.
3. Read `report` and `repair`. Findings identify rule/check, target, source path,
   observation and correction. Preserve missing or unsupported evidence.
4. The coding agent chooses a specific correction. Load the project with
   `loadProject(configPath)`, inspect `previewRepair(project, repair, change)`,
   then call `applyRepair(project, repair, change, {receiptDirectory})`.
   The receipt directory must already exist at an absolute private path outside
   the served project.
   A change contains one allowed `path`, an exact unique `before` string and an
   `after` string. There is no shell command or model execution inside this API.
5. The API checks the current artifact/spec hashes, acquires an exclusive repair
   lock, stages a single-file replacement, rechecks freshness, and returns a new
   artifact hash with `requiresBrowserRecheck: true`.
6. Rerun the browser verifier. A successful file write is not a verification pass.

Configuration, all allowed source files and generated CSS participate in the
artifact hash. The canonical button/dialog/accessibility documents participate
in the spec hash. Changing either invalidates earlier repair evidence.

The repair lock prevents cooperating repair processes from overlapping. A crash
can leave a lock requiring explicit operator inspection; it is never silently
stolen. An external editor is not governed by the lock. Detected concurrent edits
abort; this is not a hostile-filesystem transaction guarantee. A durable prepared receipt stores the exact original and intended contents
before mutation. `undoRepair(project, receiptPath, {receiptDirectory})` restores
only when the entire current project and specification still match the repaired
snapshot. Undo itself produces a recovery receipt. Preserve these private receipts. The API accepts trusted local reports, not authenticated
remote attestations, and grants no commit, deployment or release authority.

## Additional checks and limits

| Check | Basis | Supported observation |
| --- | --- | --- |
| Input label | STYLE-A11Y-003 | Visible associated HTML label |
| Invalid input | STYLE-A11Y-006 | `aria-invalid`, visible associated error text and focus |
| Disabled state | PROJECT-DISABLED-001 | Declared control has native `disabled` |
| Loading state | PROJECT-LOADING-001 | Declared `aria-busy` and associated visible status text |
| Horizontal overflow | PROJECT-LAYOUT-001 | Document width at the current viewport |
| Other close actions | STYLE-A11Y-012 | Dialog closes and focus returns through each action |

`PROJECT-*` checks are declared product contracts, not canonical WCAG rules.
Loading checks inspect a displayed state, not a completed background operation.
Error text presence/association is measured; whether it describes the right
correction still needs human review. ARIA-only custom controls, shadow DOM,
invalid-input focus visibility/contrast,
screen-reader behavior, arbitrary accessible-name computation, and overlay
occlusion are outside current coverage. Test required viewport sizes explicitly;
one viewport's pass is not a responsive-design certification.

Provider normalization also rejects replacement of an existing token object and
malformed dimension values before critique. These deterministic failures provide
feedback to the calling agent; no automatic unbounded model retry is added.

## Developer entry points

From the repository root:

```sh
pnpm project validate examples/profile/project.json
pnpm project serve examples/profile/project.json 4181
pnpm project report examples/profile/project.json /private/profile-report.json
pnpm project preview examples/profile/project.json /private/repair.json /private/change.json
pnpm project apply examples/profile/project.json /private/repair.json /private/change.json /private/receipts
pnpm project undo examples/profile/project.json /private/receipts/repair-ID.json /private/receipts
```

Use absolute paths appropriate to your operating system for private files.
`change.json` contains `path`, `before` and `after`; replacement text is literal.
`repair.json` is the `repair` field from a browser result. Preview prints exact
removed/inserted text and the complete intended contents for review. Receipt and
report files can contain private project source or UI text: keep them outside
public repositories and restrict directory access using your operating system.

The browser entry point accepts an already connected CUA-compatible tab:

```js
const { verifyConfiguredProject } = await import('/absolute/repository/scripts/project-cli.mjs');
const summary = await verifyConfiguredProject({
  tab, configPath: '/absolute/project/project.json',
  origin: 'http://127.0.0.1:4181/', outputPath: '/private/new-report.json'
});
```

Open the preview in that browser first. The adapter exercises the configured
journey, verifies the source binding and writes a new report without overwriting
an existing file. A standalone browser driver is not bundled. Configuration and
report commands work without one. Report exit codes are 0 for all recorded checks
passing, 1 for findings, and 2 for incomplete evidence or command errors. These
are trusted local reports, not authenticated attestations or proof that omitted
checks were performed.

Error associations support space-separated `aria-describedby` references and
`aria-errormessage` (preferred when declared); no alert role is required. Referenced
text may also contain hints, so a pass establishes association and visibility,
not the correctness of the correction. Loading references must include visible
nonempty `role="status"` text. Hidden, transparent and `aria-hidden` ancestors
are rejected. Clipping, overlays, partial opacity and screen-reader announcement
remain outside this bounded collector.

## Interrupted repair recovery

A `phase: prepared` receipt records intent, not success. After an interruption,
inspect the current source, receipt and lock owner. Never delete another live
process's lock. Once the owner is confirmed stopped, preserve the receipt and
inspect any staged temporary file before explicitly removing the abandoned lock.
If source still matches the original snapshot, obtain/review a fresh repair; if
it matches the intended snapshot, guarded undo is available. Any other state
requires manual reconciliation with source control. The API refuses stale undo.

Only valid UTF-8 source is supported; BOMs and line endings are preserved. Receipt
and staged-file data are flushed before rename. There is no cross-platform
power-loss guarantee for directory metadata, and non-cooperating external editors
can still race between the final check and rename. Use a quiet checkout for repairs.

Native `outline: auto` requires separate rendered review and is reported as
unsupported, including its contrast result. A computed color ratio alone does
not establish the browser's actual native focus treatment.
