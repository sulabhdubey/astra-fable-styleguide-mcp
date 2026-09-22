# Internal rendered-UI verification

This experimental workflow checks a configured button/dialog journey against
canonical rules. It supplements the source checker; it is not a complete
accessibility audit or an arbitrary UI certification service.

## Run the example

```sh
pnpm install --frozen-lockfile
pnpm dev:ui-lab
```

Open `http://127.0.0.1:4178/` for the settings example. It supports validation,
review, cancel, confirmation and reset. Preferences last for the page session.
The loopback server exposes only the example, the two existing agent fixtures,
canonical generated CSS and hash metadata. It has no write API.

`scripts/browser-suite.mjs` exports `runUiSuite(tab, origin)`. The tab must expose
the documented CUA browser methods used in `scripts/browser-journey.mjs`.
Run it through the browser-control environment after inspecting the local page.
It does not launch a browser itself. Browser evaluation reads DOM and computed
styles; keyboard and pointer interactions use the tab adapter.

The suite exercises the settings example, eight injected faults, and the
existing Codex and Grok fixtures. `passed` means the good cases passed and each
negative control produced its expected finding. A broken fixture's report
should remain `fail`.

## Coverage and evidence

| Check | Canonical rule | Observation |
| --- | --- | --- |
| Button target | STYLE-A11Y-009 | Rendered width and height |
| Keyboard focus | STYLE-A11Y-001 | Active element, focus-visible and outline |
| Focus contrast | STYLE-A11Y-010 | Opaque outline against a flat adjacent surface |
| Dialog name | STYLE-A11Y-011 | Visible heading reference and accessible role/name |
| Dialog focus | STYLE-A11Y-012 | Initial focus, forward/backward traversal, restoration |
| Escape | STYLE-A11Y-013 | Dismissal, or an explicitly declared exception |

Missing evidence is `not_checked`. Unsupported treatments, such as a
box-shadow-only ring or a translucent surface, remain `unsupported`.
Configured targets are recorded even when missing. The runner samples restored
focus for 1.2 seconds to catch delayed native-dialog close handlers; later
changes remain outside this window.

The contract hashes the three canonical button/dialog/accessibility documents.
The artifact hash covers the exact served HTML and generated CSS. Neither hash
is a signature or a claim that every repository file was verified. Source
hashes are compared before and after the journey; a mutation aborts that case.

`createRepairPacket` maps findings to explicit repository paths and rule IDs.
It requires the currently expected artifact and spec hashes. Failed measured
checks are `observed`; incomplete or unsupported findings are `unverified`.
It consumes trusted local observations, not model-authored proof. Repairing the
artifact changes its hash, requiring a fresh report. It grants no release
authority.

Limitations include light DOM, configured buttons and one dialog path, finite
keyboard traversal, no full overlay/occlusion analysis, no screen-reader session,
and no general visual-quality score. A source check, browser check, model review
and human review are different kinds of evidence.

## Model critiques and bounded comparison

Provider critiques are marked `unverified`, including objections that claim a
measurement. The adapter computes the reviewed candidate hash itself and
rejects a revision when that bound candidate changed. This adds provenance;
it does not turn model agreement into test evidence or release permission.

For an optional local feasibility experiment, compile the core and run:

```sh
pnpm compile:core
node scripts/compare-local-design.mjs /private/output/comparison.json
```

The script uses installed Ollama models, a loopback endpoint, one radius brief,
one attempt per arm and a 2,400 generated-token ceiling per arm. The single
arm gets three calls of up to 800 tokens; the pair gets six of up to 400.
Prompt/output counts and elapsed time are recorded. Actual input budgets and
model composition differ, so this is a feasibility comparison rather than a
causal benchmark of agent count or design quality. External inference is never
required by CI. Output creation refuses to overwrite an existing receipt.

The initial local run produced an invalid single-agent candidate and a
deadlocked pair. Deterministic checks rejected both. That result supports
keeping the evaluator and approval boundaries; it provides no evidence that
two agents improve the design. Further tuning is a separate experiment.
