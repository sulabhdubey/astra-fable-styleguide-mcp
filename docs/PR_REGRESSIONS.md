# Pull-request regression evidence

This workflow compares two local verification receipts that are each bound to an exact Git commit, tree, project configuration, and constitution hash. It reports new violations, resolved findings, existing violations, and incomplete observations separately. It does not post a PR comment, use a write token, run against `pull_request_target`, or authorize a repair, commit, release, or publication.

Capture a receipt only from a checkout whose configured inputs are committed at `HEAD`:

```sh
stylecon ci capture /absolute/project/project.json /private-evidence/base.json
stylecon ci capture /absolute/project/project.json /private-evidence/head.json
stylecon ci compare /private-evidence/base.json /private-evidence/head.json --format markdown
```

`capture` refuses a changed configuration, source/build/identity input, pinned constitution, or Git commit while it is running. Schema v1 receipts bind configured static inputs. Schema v2 receipts bind every configured source, build, and identity-file byte; their configured source paths label findings but do not certify browser build-to-source correspondence.

`compare` refuses a missing baseline, tampered receipt, different project path, constitution/configuration mismatch, or changed check coverage. Its exit code is 0 only when all compared checks pass; it returns 1 for new or existing failures and 2 for incompatible or incomplete evidence. Markdown escapes project-controlled values and includes the recorded observed and expected values where available.

The checked UI and evidence can contain private source text. Store receipts outside the repository and review artifact access before copying the [manual workflow example](examples/stylecon-pr-regression.yml) into `.github/workflows`. The example accepts explicit reviewed base/head/checker SHAs, installs the CLI once from the trusted checker ref with `npm ci --ignore-scripts`, resolves `stylecon` before target worktrees exist, and invokes that locked binary by absolute path. The base and head live in separate detached worktrees, so neither can replace the checker. It requires the checker ref to be a reviewed consumer checkout with the exact CLI package in `package-lock.json`; it does not rebuild the checker from either target revision.

Capture creates a receipt even when its configured check finds violations or incomplete evidence, so that `compare` can classify the result. The final compare command controls the workflow exit code.

The supplied workflow checks self-contained static projects. Running-app capture additionally requires a trusted preview already serving the committed build; the example does not launch application commands or build untrusted PR code. Browser runtime failures abort capture and fail the job; they never create a clean comparison.
