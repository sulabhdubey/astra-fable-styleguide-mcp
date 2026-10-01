# Local Studio

Studio is a local interface to the existing checker, repair engine and constitution authoring tools. It is included in this development checkout and its development CLI archive; the published v0.6.0 archive does not include it.

After [installation](INSTALLATION.md), create an empty evidence directory outside your workspace, then run:

```sh
npx --no-install stylecon studio /absolute/workspace --evidence /absolute/private-evidence
```

From a built source checkout use `pnpm stylecon studio` with the same arguments. Open the exact local link printed by the command, including its session fragment. Keep the link private. Studio listens only on `127.0.0.1`; Ctrl+C stops it. It does not upload projects, start project scripts or run an AI provider.

## Check and correct

1. Select a project. Discovery looks up to three directories below the workspace and skips dependency, generated and hidden folders. Existing `project.json` files are used directly.
2. For an unconfigured static HTML project, supply its file list, open button ID, dialog ID, close button ID and dialog name. Configuration is validated and created exclusively; existing files are not overwritten.
3. Run checks. Chromium exercises the declared controls. Only use a trusted project and synthetic test data. For [React/Vite](RUNNING_APP.md), manually start its reviewed production preview first.
4. Inspect highlighted findings. Details show the actual element selector, configured source file, rule, observed value, expected value where recorded, and correction guidance. JSON and inert HTML evidence are saved privately.
5. For a static project with mapped failures, supply one exact before/after replacement in an allowed file. Review the preview and apply that exact hash. The existing engine rejects stale source, invalid mappings and ambiguous replacements.
6. Studio rechecks after applying. Undo restores the original bytes only while the edited source still matches its receipt, then runs checks again. Receipts survive locally; CLI undo is available after a Studio restart. Studio itself retains only the latest correction per project in the current session.

For running React/Vite applications, explicitly mapped public stylesheets can offer verified literal CSS corrections. Select a recorded candidate, inspect the exact preview and apply it. Studio asks you to rebuild the trusted project before running checks again; undo also requires a rebuild. Other running-app findings remain observation-only. See the [supported mapping and limitations](RUNNING_APP.md#verified-css-corrections). Missing or unsupported evidence is visible. Passing configured checks is not a whole-application accessibility certification.

## Create a team constitution

Choose a workspace containing the source constitution repository as a child directory, so the new export can be a sibling. In **Create rules**, load that child directory (for example `design-rules`), choose existing typography, spacing, color or button target rules, and add changes to review. CSS imports are suggestions: each requires an explicit selection. Exceptions retain a rule, target and reason; they never silently waive checks.

Validate the candidate, inspect its before/after diff and exact hash, then approve and export to a new sibling directory. Original rules remain unchanged. A review record accompanies the exported `/spec`. Use `stylecon constitution pin` on the exported copy to adopt it in a project. Validation or export errors remain visible; a source mutation invalidates the candidate.

## Local boundaries

Only packaged interface assets are served. Workspace files are accessed through bounded operations, never exposed by a file server. API requests require the local origin and session credential; symlinks, traversal and oversized requests are rejected. Evidence must be outside the selected workspace. Checks run serially; changed-source errors require a fresh check. The API is a same-machine session boundary, not protection against another malicious process running as your OS user.
