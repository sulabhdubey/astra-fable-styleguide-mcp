# Local Studio

Studio is a local interface to the existing checker, repair engine and constitution authoring tools. It is included in the published v0.7.0 CLI archive. The guided React/Vite setup and coverage summary described below are additions in this development checkout; they are not included in the v0.7.0 archive.

After [installation](INSTALLATION.md), create an empty evidence directory outside your workspace, then run:

```sh
npx --no-install stylecon studio /absolute/workspace --evidence /absolute/private-evidence
```

From a built source checkout use `pnpm stylecon studio` with the same arguments. Open the exact local link printed by the command, including its session fragment. Keep the link private. Studio listens only on `127.0.0.1`; Ctrl+C stops it. It does not upload projects, start project scripts or run an AI provider.

## Check and correct

1. Select a project. Discovery looks up to three directories below the workspace and skips dependency, generated and hidden folders. Existing `project.json` files are used directly.
2. For an unconfigured project, choose its type. Static HTML setup accepts a file list and dialog controls. The development checkout also offers guided React/Vite setup below. Configuration is created exclusively; existing files are not overwritten.
3. Run checks. Chromium exercises the declared controls. Only use a trusted project and synthetic test data. For [React/Vite](RUNNING_APP.md), manually start its reviewed production preview first.
4. Inspect highlighted findings. Details show the actual element selector, configured source file, rule, observed value, expected value where recorded, and correction guidance. JSON and inert HTML evidence are saved privately.
5. For a static project with mapped failures, supply one exact before/after replacement in an allowed file. Review the preview and apply that exact hash. The existing engine rejects stale source, invalid mappings and ambiguous replacements.
6. Studio rechecks after applying. Undo restores the original bytes only while the edited source still matches its receipt, then runs checks again. Receipts survive locally; CLI undo is available after a Studio restart. Studio itself retains only the latest correction per project in the current session.

For running React/Vite applications, explicitly mapped public stylesheets can offer verified literal CSS corrections. Select a recorded candidate, inspect the exact preview and apply it. Studio asks you to rebuild the trusted project before running checks again; undo also requires a rebuild. Other running-app findings remain observation-only. See the [supported mapping and limitations](RUNNING_APP.md#verified-css-corrections). Missing or unsupported evidence is visible. Passing configured checks is not a whole-application accessibility certification.

## Guided React/Vite setup (development checkout)

Select an unconfigured project containing `index.html`, then choose **React / Vite production preview**. Build the trusted application using its reviewed build command before setup.

1. Supply an explicit `http://127.0.0.1:PORT/` preview origin, source and build directories, and identity files such as `package.json`, the lockfile and Vite configuration.
2. Choose the open button, dialog and close button by distinct plain `#id` selectors, the dialog's accessible name, and their source file. This first guided flow uses one source label; richer mappings remain available through a reviewed [project.json](RUNNING_APP.md).
3. Choose one initially visible measurement target and at least one bundled canonical font-size or top-padding token. For example, `typography.fontSize.500` and `space.4`. The review resolves actual values from `/spec`; it does not invent rules.
4. Select **Validate & review setup**. Inspect the resolved rules, scope and exact configuration, then **Save reviewed configuration**. Changed form inputs invalidate the displayed review. Source, build, identity or rule changes require a new review; saving never overwrites an existing `project.json`.
5. Start the trusted production preview yourself and select **Run checks**. Offline setup does not contact the application or verify browser targets. Only the browser check provides observed evidence.

The wizard starts with bundled rules and observation only. It does not add repair authorizations. Pinned team constitutions, additional measurements and verified stylesheet mappings use the existing reviewed configuration format. Missing build files must be resolved by building the trusted project; Studio never runs package scripts for you.

## Reading coverage (development checkout)

Studio, text reports and HTML reports show how many recorded checks were evaluated, with separate passed, failed, not-checked and unsupported counts. The denominator is recorded checks, **not a percentage of the application covered**. Targets, journey viewport and measurement viewports are listed separately: the running-app dialog journey executes at 1280px, while design measurements execute at 1280px and 390px. Other routes, widths and unexercised states remain untested.

Incomplete checks show the recorded reason and next action before the detailed findings. Older reports without viewport metadata say **not recorded**. Changing the presentation does not change pass/fail decisions or authorize release.

While an action runs, workspace controls are disabled to keep its project and inputs fixed. They unlock on success or error; focus returns to the initiating control or the status message when that control is no longer visible. Starting a recheck clears the prior displayed result and repair authorization, including when the new check fails. A previously applied correction's undo receipt is retained, subject to the existing source checks. Design measurements record their actual selector separately from the source-mapping label when those differ.

## Create a team constitution

Choose a workspace containing the source constitution repository as a child directory, so the new export can be a sibling. In **Create rules**, load that child directory (for example `design-rules`), choose existing typography, spacing, color or button target rules, and add changes to review. CSS imports are suggestions: each requires an explicit selection. Exceptions retain a rule, target and reason; they never silently waive checks.

Validate the candidate, inspect its before/after diff and exact hash, then approve and export to a new sibling directory. Original rules remain unchanged. A review record accompanies the exported `/spec`. Use `stylecon constitution pin` on the exported copy to adopt it in a project. Validation or export errors remain visible; a source mutation invalidates the candidate.

## Local boundaries

Only packaged interface assets are served. Workspace files are accessed through bounded operations, never exposed by a file server. API requests require the local origin and session credential; symlinks, traversal and oversized requests are rejected. Evidence must be outside the selected workspace. Checks run serially; changed-source errors require a fresh check. The API is a same-machine session boundary, not protection against another malicious process running as your OS user.
