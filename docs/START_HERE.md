# Start here

Choose one first task. You do not need two AI models or every part of the project.

| First task | Start here | First useful result |
| --- | --- | --- |
| Understand the workflow without installing anything | [Interactive demo](https://sulabhdubey.github.io/astra-fable-styleguide-mcp/demo/) | See a 24px button fail this project's 40px rule, review the supplied correction and recheck. |
| Give a coding agent approved design rules | [Connect the public MCP](#1-connect-the-public-design-rule-mcp) | Your agent retrieves and cites the rules it will use. |
| Measure a supported interface on your machine | [Install and try one repair](#3-install-and-try-one-repair) | A browser report identifies the checked element, expected rule and observed value. |

The released baseline for this guide is [v0.10.1](https://github.com/sulabhdubey/astra-fable-styleguide-mcp/releases/tag/v0.10.1).
The local CLI includes Studio, guided React/Vite setup, reviewed team-rule adoption,
private history and candidate comparison. The hosted MCP and local checker are
separate: connecting the server does not install or start the checker.

## 1. Connect the public design-rule MCP

Use an MCP client that accepts a Streamable HTTP server URL:

```text
https://astra-fable-styleguide-mcp.vercel.app/mcp
```

No project account or provider key is required for this public server. Your coding
agent may have its own subscription or model costs. The service exposes eight
read/compliance tools; it cannot inspect your local browser or edit your project.
Only submit information you intend to send to the hosted service. Its rules are
the project's published constitution; it does not load your local custom rules.

Ask your connected agent:

> Read the Style Constitution manifest and button/dialog rules. Explain which rules apply to my interface, cite their rule IDs, and separate declared rules from anything you have actually measured. Do not edit files yet.

Success: the client lists eight tools, including `get_style_manifest`,
`get_component_rules`, and `check_style_compliance`. Read the manifest response to
identify the version actually served. A rule lookup is not evidence that your UI
passed a rendered check. The browser documentation and `/version` are human checks;
opening `/mcp` in a browser does not perform an MCP handshake and can return
“Method not allowed.” Use [guided client setup](https://sulabhdubey.github.io/astra-fable-styleguide-mcp/start/)
to connect, and approve the intended tools in your client when prompted.

## 2. Decide whether the local verifier fits

The experimental verifier runs isolated Chromium locally. No desktop browser
connection or AI provider is required. Choose a supported integration:

| Your project | Setup and limits |
| --- | --- |
| Trusted static HTML/CSS/JavaScript | Configure files and plain `#id` targets for a button/dialog journey. Native input, textarea and select error journeys are also supported. Start with the [repair demo](DEMO.md) and [configuration guide](PROJECT_WORKFLOW.md). |
| Trusted React/Vite production preview | Build and start the preview yourself. Use [Studio's guided setup](LOCAL_STUDIO.md#guided-reactvite-setup) for a root preview URL, dialog journey and selected measurements. [Running-app configuration](RUNNING_APP.md) documents source labels and the narrow CSS repair adapter. |
| Storybook component states | A [separate development trial](https://github.com/sulabhdubey/astra-fable-styleguide-mcp/pull/56), not part of v0.10.1. It requires its pinned integration and verified candidate package. |

Next.js, Vue, Svelte and arbitrary applications are not supported integrations.
Custom comboboxes, shadow DOM and complete accessibility coverage are outside the
verified scope. Use trusted, self-contained projects: network requests are
restricted, and errors or blocked resources make verification incomplete.

## 3. Install and try one repair

For installation from an archive, use Node 22.12 or newer. Download
`styleconstitution-cli-0.10.1.tgz`, `install-cli.mjs` and `SHA256SUMS` from the same
[v0.10.1 release](https://github.com/sulabhdubey/astra-fable-styleguide-mcp/releases/tag/v0.10.1).
Follow [verified installation](INSTALLATION.md), including the installer checksum
check and the command that verifies the archive before installing it. The CLI is
not on the npm registry; do not substitute a similarly named package.

After installation, run these from the new consumer directory. Replace
`/absolute/new-demo` with a new absolute path whose parent exists, such as
`C:/Temp/style-demo` on Windows:

```sh
npx --no-install stylecon browser-install
npx --no-install stylecon doctor
npx --no-install stylecon demo /absolute/new-demo
npx --no-install stylecon check /absolute/new-demo/project --format json --output /absolute/new-demo/evidence/before.json
```

The demo creates a disposable project, an evidence directory and a supplied
correction. **The first check intentionally exits 1.** Inspect `before.json` for
`STYLE-A11Y-009` on `#review`: roughly 24px observed against a 40px minimum. Other
findings must also be read. Follow [review, apply and recheck](DEMO.md#review-and-apply),
using `npx --no-install stylecon` in place of that source-checkout guide's
`pnpm stylecon` prefix. Never treat a successful file edit as a passing recheck.

### Build from source instead

To build from source instead, also install Git and pnpm 10.34.5:

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
model performance. The archive includes the checking runtime, canonical rule/CSS
snapshot and demo, so a repository checkout is not needed at runtime. Creating a
new constitution with `validate` still requires a separate spec repository.

### Use the local interface

After the demo is created, open it in Studio with a separate, empty private
evidence directory outside the workspace:

```sh
npx --no-install stylecon studio /absolute/new-demo --evidence /absolute/private-studio-evidence
```

Create the empty evidence directory first. Open the exact local URL printed by
Studio, including its private session fragment, select `project`, run checks and
inspect findings. For supported static repairs, review an exact replacement before
applying it, then inspect the recheck; undo is available while source still matches
the receipt. The [Studio guide](LOCAL_STUDIO.md) covers the full flow and React/Vite
rebuild requirements. Studio does not run your project's scripts or an AI model.

### Reports and CI

`stylecon check <project> --format json` emits source-bound observations and a
repair packet. `--format sarif` emits file/target findings without invented line
numbers. `--format html` produces readable observations; `--compare` accepts a
previous JSON report with compatible rules, configuration and coverage.
`--output /private/new-file` saves exclusively outside the served project.
Exit 0 means all recorded checks pass, 1 means violations, and 2 means usage,
runtime failure or incomplete checks. Runtime errors are on stderr; with JSON
format they use `{ "status": "not_checked", "error": "..." }`.
The repository CI runs the same standalone integration suite and retains a
synthetic example SARIF artifact. No external AI service is required.

## 4. Try your own supported project

For a static project, run `stylecon init <project-directory>` to configure one
supported journey. For React/Vite, follow [guided setup](LOCAL_STUDIO.md#guided-reactvite-setup)
or the [complete configuration example](RUNNING_APP.md). Use the installed
`npx --no-install stylecon` prefix or the source-checkout `pnpm stylecon` prefix.
Declare only files and targets you want checked. Setup preserves existing
configuration; advanced static configurations can use `examples/profile/project.json`.
Use synthetic form values. See the
[configuration and recovery guide](PROJECT_WORKFLOW.md) for the complete contract.
Keep reports and original-content receipts in a private directory outside the
served project and outside any public repository.

Record setup help, incorrect findings, missed defects, repair outcomes and whether
the change preserves your intended design. A pass covers only recorded checks.

To use your own standard, [author and review a constitution](CONSTITUTION_AUTHORING.md)
and [adopt its exact snapshot locally](INDIVIDUAL_AND_TEAM_WORKFLOWS.md).
To hand a finding to a coding agent, export a correction brief from Studio and
review its contents before sharing it with your chosen provider. For pull requests,
see [regression summaries](PR_REGRESSIONS.md). For comparing alternative fixes,
see [candidate comparison](CANDIDATE_COMPARISON.md).

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
