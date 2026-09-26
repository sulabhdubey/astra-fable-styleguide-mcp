# Start here

Give your coding agent a shared set of design rules, then check a supported interface against them.

## 1. Connect the public design-rule MCP

Use an MCP client that accepts a Streamable HTTP server URL:

```text
https://astra-fable-styleguide-mcp.vercel.app/mcp
```

No project account or provider key is required for this public server. Your coding
agent may have its own subscription or model costs. The service exposes eight
read/compliance tools; it cannot inspect your local browser or edit your project.

Ask your connected agent:

> Read the Style Constitution manifest and button/dialog rules. Explain which rules apply to my interface, cite their rule IDs, and separate declared rules from anything you have actually measured. Do not edit files yet.

Success: the client lists eight tools, including `get_style_manifest`,
`get_component_rules`, and `check_style_compliance`. The manifest currently reports
v0.5.1. The browser documentation and `/version` are human checks; opening `/mcp`
in a browser does not perform an MCP handshake.

## 2. Decide whether the local verifier fits

The experimental verifier supports trusted static HTML/CSS/JavaScript with
light-DOM ID targets and a configured button/dialog journey. The standalone CLI
runs an isolated Chromium instance; no desktop browser connection or AI call is
required. Native input, textarea and select error journeys are supported.
Custom comboboxes, shadow DOM, arbitrary frameworks and complete accessibility
coverage are not supported. Use only trusted, self-contained projects: network
requests are restricted, and errors/blocked resources make verification incomplete.

## 3. Install and try one repair

Prerequisites: Git, Node 22.12 or newer and pnpm 10.34.5.

```sh
git clone https://github.com/sulabhdubey/astra-fable-styleguide-mcp.git
cd astra-fable-styleguide-mcp
pnpm install --frozen-lockfile
pnpm build
pnpm stylecon browser-install
pnpm stylecon doctor
pnpm stylecon check examples/profile
```

Then follow the [repair demo](DEMO.md). It starts with an intentional 24px button,
records a real rendered finding, applies a reviewed correction and rechecks it.
The correction is provided for reproducibility; it is not evidence of autonomous
model performance. The standalone CLI and these demo setup commands are included in v0.5.0.

### Install a packed CLI without a repository checkout at runtime

Build first, then `npm pack ./packages/cli`. In another directory, run
`npm install /absolute/path/styleconstitution-cli-0.5.1.tgz` and use
`npx stylecon --help`. The archive contains the checking runtime, canonical
contract/CSS snapshot and demo. Use `npx stylecon browser-install` if Chromium
is absent. The package is not yet on npm; do not substitute a similarly named
registry package. The `validate` command still expects a separate spec repository.

### Reports and CI

`stylecon check <project> --format json` emits source-bound observations and a
repair packet. `--format sarif` emits file/target findings without invented line
numbers. `--output /private/new-file` saves exclusively outside the served project.
Exit 0 means all recorded checks pass, 1 means violations, and 2 means usage,
runtime failure or incomplete checks. Runtime errors are on stderr; with JSON
format they use `{ "status": "not_checked", "error": "..." }`.
The repository CI runs the same standalone integration suite and retains a
synthetic example SARIF artifact. No external AI service is required.

## 4. Try your own supported project

Copy the configuration structure from `examples/profile/project.json`. Declare
only files and targets you want checked. Use synthetic form values. See the
[configuration and recovery guide](PROJECT_WORKFLOW.md) for the complete contract.
Keep reports and original-content receipts in a private directory outside the
served project and outside any public repository.

Record setup help, incorrect findings, missed defects, repair outcomes and whether
the change preserves your intended design. A pass covers only recorded checks.

## When something fails

| Symptom | Next step |
| --- | --- |
| Client cannot connect | Check the exact MCP URL, Streamable HTTP support and client error. Do not enter a provider key into this service. |
| Chromium unavailable | Run `stylecon browser-install`, then `stylecon doctor`. Missing browsers never produce a pass. |
| Local preview blocked | Confirm the printed loopback URL opens in your browser. Let the user resolve browser security blocks; do not disable protections automatically. |
| Configuration rejected | Check allowlisted relative paths, unique ID targets and source mappings. |
| Stale report or repair | Recheck the current source. Do not remove hash checks. |
| Unsupported result | Inspect that treatment manually; do not convert it to a pass. |
| Interrupted repair | Preserve the receipt and inspect the lock owner; follow the recovery guide. |

## Dialog verification boundaries

The verifier exercises actual Chromium keyboard input on the configured dialog.
It records initial focus, bounded forward/backward Tab containment, Escape and
focus return. These observations cover only the declared journey.

Detected iframe/object/embed content, open shadow roots, and visible semantic
nested overlays make affected focus checks `unsupported`, not passing evidence.
Escape and focus-return judgments are also unsupported when these surfaces are
present before Escape. An inner popover can correctly consume Escape without
closing its parent dialog; this requires a dedicated nested interaction journey.
The report records the detected scope risks. Unsupported results remain incomplete
and are not proof of a product defect.

Closed shadow roots and custom overlays without recognizable semantics cannot be
reliably detected. Hidden or unopened interactions are not exercised automatically.
Browser role/name matching is not screen-reader verification: test announcements
and operation with actual assistive technologies separately (for example,
VoiceOver/Safari). No screen-reader result is inferred from DOM or keyboard checks.

Run `node scripts/test-dialog-boundaries.mjs` after installing Playwright Chromium
for the native-dialog, embedded-content, shadow-root and nested-overlay regression.

Additional focus cases: `<details>` without an explicit `<summary>` and visible
`data-a11y-dialog-ignore-focus-trap` integrations are reported as unsupported.
Explicit summaries are included in traversal bounds. Regression cases also cover
container initial focus (`tabindex="-1"`), an autofocus control, and focus return
for supported native journeys. This handling was informed by the
[a11y-dialog focus considerations](https://a11y-dialog.netlify.app/advanced/focus-considerations/).
