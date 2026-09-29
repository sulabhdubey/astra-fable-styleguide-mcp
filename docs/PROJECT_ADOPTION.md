# Configure and check your project

These commands are development changes after v0.5.1. Use a reviewed archive built
from this source; the existing v0.5.1 release does not contain `init`, constitution
pinning, or HTML reports.

## Install a reviewed archive

Use Node 22.12 or newer. Compare the archive's SHA-256 with `SHA256SUMS` from the
same trusted release or CI artifact. In a new consumer directory:

```sh
npm init -y
npm install --save-exact /absolute/path/to/reviewed-stylecon.tgz
npx --no-install stylecon browser-install
npx --no-install stylecon doctor
```

Browser installation is explicit. Checking a project needs no model or provider
key. Use only trusted, self-contained static HTML/CSS/JavaScript. The verifier
supports configured light-DOM ID targets and a button/dialog journey, including
native input, textarea and select error journeys. It does not support arbitrary
frameworks, custom comboboxes, shadow DOM, or complete accessibility coverage.

## Guided setup

```sh
npx --no-install stylecon init /absolute/path/to/project
```

Select the source files, trigger, dialog, close button, visible dialog title, and
optional form input. Setup displays the scope before saving a new `project.json`.
It reads source hints without running your page and refuses to overwrite existing
configuration. A browser check verifies that the selected targets actually work.

For a reproducible setup using the bundled profile fixture:

```sh
stylecon init ./project --files index.html --trigger '#review' --dialog '#review-dialog' --close '#back' --name 'Confirm display name' --input '#display-name' --submit '#review' --invalid-value '' --valid-value 'Studio member' --yes
stylecon check ./project
```

The shell must preserve the quoted empty argument. Use synthetic form values;
configuration and reports are local files and may contain project details. Setup
currently maps targets to `index.html`. Additional explicitly selected CSS/JS
files are allowed; no project scripts or package installation hooks are run.

## Pin a team's constitution

Each constitution repository keeps `/spec` as its canonical source. Export a
validated derivative into your consumer project, outside that canonical `/spec`:

```sh
stylecon constitution pin /path/to/constitution-repository ./project/constitution.json
stylecon init ./project --constitution constitution.json
```

The export includes all canonical JSON documents and returns a full SHA-256.
Setup writes this hash and the relative snapshot path into `project.json`.
Existing configurations can explicitly add the same `constitution` object:

```json
{"constitution":{"path":"constitution.json","sha256":"<full SHA-256 returned by pin>"}}
```

The checker validates the snapshot, regenerates CSS from its tokens, and records
its identity in the report. A 48px team target requirement is checked as 48px;
the bundled rule is not silently substituted. Unsupported behavior contracts
are rejected. Arbitrary scripts or precompiled CSS cannot be supplied as snapshot
fields. The snapshot and configuration are not served as page assets.

To update rules, review a new canonical source, export a new snapshot, and update
the full pin explicitly. An edited snapshot with the old hash is refused. Rule,
token, version and configuration changes invalidate prior repair evidence. An
export or project pin is not consensus, approval to mutate a canonical source, or
release authorization.

## Read and compare evidence

Create the private output directory first, outside the served project:

```sh
stylecon check ./project --format json --output ./private-evidence/before.json
# Review and apply a bounded correction using the existing repair workflow.
stylecon check ./project --format json --output ./private-evidence/after.json
stylecon report ./project --format html --compare ./private-evidence/before.json --output ./private-evidence/recheck.html
```

`report` runs a fresh browser check. The HTML file contains readable observations,
rule guidance, coverage limits and evidence identifiers. It has no remote assets,
scripts or telemetry. Comparison requires matching specification, configuration
and check coverage. It records resolved and regressed checks; changed or missing
bindings make comparison unavailable. This is observed before/after evidence,
not proof that an edit caused a result.

Exit codes are **0** for recorded pass, **1** for violations, and **2** for invalid
usage, runtime failure or incomplete coverage. An output file is never evidence
that a check passed. Existing output files are preserved. For repairs, see
[the repair demo](DEMO.md) and retain private recovery receipts.

## Produce and verify an archive

From the development checkout, run the repository gates and `pnpm build`. Choose
an existing empty output directory outside the source checkout:

```sh
node scripts/package-cli.mjs /private/empty-output --development
node scripts/verify-cli-archive.mjs /private/empty-output --browser
```

The development filename includes its source-input hash. The bundle includes
`SHA256SUMS`, source/package evidence, and an archive verification receipt. The
verifier installs that exact archive into a clean consumer, using locked local
runtime dependencies, and tests setup, pinning, browser reports and the guarded
repair/recheck/undo path. It does not contact an AI provider.

Packaging refuses changed inputs or changed build output. Omitting `--development`
requires a clean commit and matching CLI/constitution versions. A release
candidate package still requires the protected exact-commit Release Gate and
publication approval. Existing releases are never replaced by this command.

## Opt-in CI

Use the [manual CI example](examples/stylecon-check.yml) only after an exact CLI
archive is installed and locked in your consumer project. Keep the archive
accessible to CI. Reports can disclose source details: configure repository and
artifact access before enabling upload. This example uses no external AI and
preserves incomplete/failure exit codes.
