# Bounded collaboration comparison

This experiment compares one logical role using strong self review with two
logical roles using independent initial proposals and cross review. It measures
deterministic constraint satisfaction and governance-ready outcomes. It does
not assume that collaboration improves results.

## Collaboration mechanics

The provider path now supports a bounded proposal contract. A caller can name
the allowed and required change paths plus the minimum and maximum change
count. Local Ollama requests turn that contract into a structured response
schema and apply value types derived from existing tokens. Provider output is
still checked after generation.

Astra applies a systems, semantic-token, and maintainability lens. Fable applies
an accessibility, interaction-state, and content-clarity lens. Both roles must
check every brief criterion. These are logical responsibilities, independent of
the configured provider.

After each initial proposal, the deterministic evaluator returns errors bound
to that proposal's exact SHA-256. The reviewer and original proposer receive
that feedback before revision. This preserves independent first proposals while
making deterministic defects actionable. Candidate approvals and release gates
continue to use the exact candidate SHA-256; these changes do not publish or
approve a candidate.

### Review and stopping rules

When proposals do not conflict, both roles review the complete merged candidate,
including changes contributed only by the other role. A valid candidate with two
complete reviews stops immediately; accepted changes are not revised just to
fill a call budget. Conflicting proposals retain both alternatives in a
reconciliation packet. Any revision must receive another review before consensus.
The last round is a review round; it cannot spend calls on an unreviewable revision.

Every review must match the reviewer, proposal ID and exact candidate SHA-256.
All changed paths need acceptance or a recorded nonblocking warning. Recorded
issues require explicit resolution by both reviewers. Issue objections are kept
separate from path objections, and revisions cannot erase earlier issues by
omitting them. Deterministic errors always prevent consensus, including when a
model incorrectly accepts a defective value. Model reviews remain unverified
judgments, not browser evidence or permission to release.

**Custom-agent migration:** `Critique.candidateHash` is now required. A custom
`DesignAgent.critiqueProposal` must compute `sha256({baseVersion: proposal.baseVersion,
changes: proposal.changes})` from the exact reviewed proposal. It must return its
own reviewer ID and that proposal's ID. Use `resolvedIssues` for exact strings
from `proposal.unresolved` that the reviewed candidate settles; use
`issueObjections: [{issue, reason}]` for remaining concerns. Missing hashes fail
closed. The bundled configured adapters and deterministic mock bind hashes
automatically. Default maximum rounds remains five.

## Current eight-call method

The `readiness-v2` suite uses three new two-change briefs: small control/icon
proportions, a compact grid with a semantic gutter reference, and a display-type
ratio. Both workflows receive identical reference data, criteria, path contracts
and deterministic feedback. The single role receives both systems and
accessibility lenses; the pair roles specialize while checking all criteria.

Both may stop early. Each has an eight-call ceiling, 400 output tokens per call,
48,000 input characters, and a 90-second arm deadline. Each individual call is
also capped at 30 seconds. The single workflow can revise up to three times;
the pair can revise once and then both review the merged result. Arm order
alternates, and each case has one attempt per workflow. The advantage criterion
is unchanged: more completed outcomes, strictly more constraint points, and no
more failed provider calls for the pair.

Run the development suite or current comparison after compiling the core:

```sh
node scripts/compare-local-design.mjs <new-private-receipt.json> --development <installed-model>
node scripts/compare-local-design.mjs <new-private-receipt.json> --suite <installed-model>
```

Append `--cpu` only when the selected model was prewarmed with CPU inference.
The receipt records the runtime choice. No model download or paid API is needed.
Reserve a new private path for every run. Do not publish raw model transcripts.

## Earlier six-call method (historical)

The development suite contains the earlier radius, control-size, and spacing
prompts. Development outcomes are never pooled with the frozen suite.

That frozen suite contained three then-fresh briefs. Each required exactly two changes:

- type scale: font size 300 and tight line height
- responsive breakpoints: medium and large breakpoints
- motion tempo: fast and normal durations

The selected installed Ollama model and reported digest are recorded in the
private receipt. Both arms receive the same model, reference data, exact brief,
criteria, proposal contract, and deterministic feedback. The single used the
Astra lens; the pair used Astra and Fable lenses. Each arm had the same limits:

- six calls
- 600 generated tokens per call at most
- 48,000 input characters at most
- a 45-second cancellation deadline per arm

The single arm uses one proposal, two self-critique and revision cycles, and a
final self review. The pair uses two independent proposals, bidirectional cross
review, and one revision per role. Arm order alternates by case. Every requested
value earns one deterministic constraint point; provider failures remain in the
denominator.

The predeclared collaboration-advantage criterion is deliberately strict: the
pair must have more governance-ready successes, a strictly higher total
constraint score, and no more provider-call failures than the single arm. A pair
success requires `CONSENSUS`; a single success requires `VALID_CANDIDATE`.

The path must be new. The harness reserves it before inference and checkpoints
completed arms. Raw model output remains private because it can contain
unreviewed content. Prewarm the selected model first. The harness checks
`/api/ps` and refuses to start matched arms when the model is not loaded, so a
cold start cannot consume only the first arm's budget. Warmup timing is recorded
separately and excluded from arm comparisons.

## Recorded evidence

The first rehearsal on 29 September 2026 used `gemma3:4b` and the three original
development briefs. Neither arm produced a valid candidate: single **0/3**,
pair **0/3**. Truncated JSON and unsupported paths caused the failures, and the
pair consumed more recorded tokens. This demonstrates no collaboration
advantage under those settings.

A later pre-v0.7 held-out run used body-font-size, strong-border-width, and
normal-line-height briefs. Both arms again scored **0/3**. Unsupported or
overlapping paths and malformed JSON caused all six arm failures. The pair made
18 calls and recorded 10,360 prompt plus 3,745 generated tokens where Ollama
reported them. The single arm made 11 calls and recorded 6,664 prompt plus 1,651
generated tokens. The pair took 87,907 ms across its arms and the single took
36,007 ms. This also demonstrates no collaboration advantage.

On 30 September 2026, one v0.7 development pass started with the same installed
`gemma3:4b` model. The single and pair arms for the first radius case both hit
the bounded request timeout, after one and two calls respectively. The run was
stopped at the declared inability condition. Ollama `/api/ps` showed no loaded
model. A separate one-token health request also timed out after 90 seconds, and
the local server log showed CUDA language weights followed by Gemma vision
projector conversion and warmup; closing the client aborted model loading. A
text-only `llama3.2:3b` health warmup also timed out while other local build work
was active. These are host runtime failures, not model-quality or collaboration
outcomes. No result retry was made and the fresh frozen suite remained untouched
at that point.

After the host became quiet, a `llama3.2:3b` warmup succeeded in 115,273 ms,
including 114,705 ms of model loading. That one-token health call was recorded
separately and excluded from both arms. The model digest was
`a80c4f17acd55265feec403c7aef86be0c25983ab279d83f3bcd3abbcb5b8b72`.
The fresh suite was then run exactly once with the frozen cases and scoring.

The single arm produced one governance-ready candidate from three cases and
scored **2/6** requested-value constraint points on returned candidates. The
pair produced one `CONSENSUS` result from three cases and scored **4/6** points
on returned candidates. Two of those pair points came from a `DEADLOCK`
candidate, so they are constraint observations rather than an approved outcome.
The single had two timed-out arms; the pair had one. Each mode had two timed-out
provider calls. The single made 11 calls and the pair made 14. Ollama reported
6,343 prompt plus 974 generated tokens for 9/11 single calls, and 8,656 prompt
plus 1,304 generated tokens for 12/14 pair calls. These are partial token totals
because timed-out calls supplied no counts.

The predeclared advantage criterion was **not met**: governance-ready successes
were tied at one. The higher pair constraint score does not establish a useful
collaboration advantage. Three timed-out arms crossed the nominal 45,000 ms cap
by 6-14 ms because the original harness checked time before a call and did not
enforce the remaining deadline around injected work. The retained private
receipt reflects that run. The harness now rejects calls with less than one
second remaining, enforces the remaining deadline for local and injected calls,
and records each call's effective timeout. The frozen suite was not rerun.
The deadline rejects work that completes after its absolute timestamp even when
synchronous work delays JavaScript timer delivery. Provider cancellation and
bookkeeping can still add small wall-clock overhead, so it is not a physical
hard stop at exactly 45,000 ms.

Deterministic tests verify proposal bounds, typed schemas, independent initial
proposals, bidirectional review, hash-bound feedback, exact candidate hashes,
and the comparison accounting. They do not establish model quality. The small
suite cannot establish aesthetic quality, general superiority, developer
adoption, subscription savings, or release readiness. Warmup, caching,
tokenization, and different review structures remain possible confounders.
Results from different local models are not pooled, and this run cannot support
a causal claim that the schema changes improved model quality.

## Review-first runtime evidence — 30 September 2026

A CPU-only development check with the installed `llama3.2:3b` model first
produced correct values but unresolved issues in both arms. Adding explicit
issue-review decisions made that development case complete in two calls for
single and four for pair (11,951 ms and 24,000 ms respectively). These are
development results, not held-out advantage evidence.

The new three-case suite was then frozen with source and case fingerprints
before inference. The model digest was
`a80c4f17acd55265feec403c7aef86be0c25983ab279d83f3bcd3abbcb5b8b72`.
Both arms used CPU inference because the earlier GPU runtime logged discovery
timeouts. Warmup was excluded from both arms. Source remained unchanged during
the trial.

| Measure | Single | Pair |
| --- | ---: | ---: |
| Completed outcomes | 1/3 | 0/3 |
| Constraint points from returned candidates | 2/6 | 0/6 |
| Provider-call failures | 1 | 3 |
| Calls | 18 | 19 |
| Total arm time | 218,891 ms | 251,684 ms |

The pair timed out on all three tasks. Single completed the grid task, returned
an invalid control-size candidate, and timed out on the typography task. Token
totals are unknown because timed-out responses lacked usage counters. This
trial demonstrates **no collaboration advantage**. It is not a matched measure
of improvement over earlier suites: tasks, runtime, prompts and budgets changed.

After this trial, deterministic regression coverage exposed and fixed issue
omission during revision. That stricter carry-forward guard has deterministic
test evidence; the frozen model trial belongs to the preceding source snapshot
and was not rerun or relabeled. Neither result establishes general design
quality, production readiness, or subscription savings.

## GPU capability diagnosis — 30 September 2026

A separate development qualification used the installed `qwen2.5:7b-instruct`
model (digest `845dbda0ea48ed749caafd9e6037047aa19acfcfd82e704d7ca97d631a0b697e`).
GPU residency was observed; cold warmup took 6,666 ms. This reused a consumed
control-proportions task for diagnosis only. It was not another fresh comparison.

The first response encoded the correct sizes as invented token references.
The adapter now rejects unknown references when editing existing token values,
and its bounded dimension/duration schema permits only known compatible
references. A second response chose known but incorrect references. A JSON-only
ablation then returned correct sizes inside token objects at scalar value paths.
The shared bounded prompt now explicitly describes scalar values, units and
token-object wrappers. These checks do not replace the deterministic evaluator.

Following that prompt change, the initial proposal passed both requested-value
checks in 1,084 ms. A negative review blocked both deliberately incorrect values
in 1,704 ms, although one reason contained stray conversation-like text. Repair
took 1,608 ms and returned incorrect references, so qualification stopped before
final review. The failures and ablation are retained separately; none was
discarded or counted as a successful comparison.

This provides narrow evidence of workable GPU latency and an improved initial
proposal on a development task. The complete model workflow remains unqualified.
Repair reliability and clean review output still require work before freezing
another unused comparison suite. No collaboration advantage is established.

### Review contamination and repair follow-up

A paired development diagnostic held the saved proposal, model, prompt and
schema constant and changed only the contaminated review sentence. Repair with
the original sentence returned wrong references in 1,409 ms; with a clean
defect statement it returned both correct sizes in 914 ms. This is a small
diagnostic observation, not a fresh comparison or general causal guarantee.

The Ollama reviewer now receives its exact response schema in the prompt,
following the provider's [structured-output guidance](https://docs.ollama.com/capabilities/structured-outputs).
Provider review output and revision input reject known conversation-control
markers, including the observed tool-call marker, before passing evidence to
another model. Text is rejected, never silently cleaned. This narrow guard
does not establish general prompt-injection protection.

The next four-stage development qualification produced a correct proposal
(1,087 ms), blocked both deliberately wrong values (1,085 ms), repaired both
values correctly (1,390 ms), and then failed final review (1,079 ms). The final
review blocked a 22px value while stating that it must be 22px. The negative
review also confused current and requested values in its explanations.
Median call time was 1,086 ms. All responses lacked the previously observed
control marker, but absence of that marker does not establish semantic quality.
The model workflow remains unqualified because the review judgments are
unreliable. No fresh comparison was run and no advantage is claimed.

### Explicit requested and observed values

The next adapter revision adds `requestedValue` and candidate-bound
`observedValue` before the explanation and verdict for bounded scalar reviews.
The parser rejects missing or incorrect observations. Requirements remain
model-derived; the adapter does not turn contradictions into approvals.
Unbounded and non-scalar reviews retain their existing representation.

The four-stage development qualification then passed: proposal 842 ms,
negative review 2,267 ms, repair 1,397 ms, final review 1,954 ms; median
1,675.5 ms. Both deliberately wrong values were rejected with correct requested
and observed values, and the corrected candidate was accepted. One explanation
ended at the schema length bound, and the revision summary remained awkward;
this was narrow candidate/review evidence, not general text quality.

A separate three-task comparison was subsequently frozen before inference,
using unused large-control/alias, outer-breakpoint and spacing briefs. These
are related task families to development, not broad out-of-distribution tests.
The same Qwen model and GPU runtime were used in both workflows, with equal
eight-call, 400-output-token-per-call, 48,000-input-character and 90-second
per-arm ceilings. Source fingerprint:
`141122cc8b1c8a08a3f9e6bae5538d4ec7dc2397966ef17315ab3cde8ce57c4e`.
Case fingerprint:
`321b4721362ea3428509da22fbc8efea9443fa9a8a8eb4eaa86531bac8a795b7`.

| Measure | Single | Pair |
| --- | ---: | ---: |
| Governance-ready outcomes | 0/3 | 0/3 |
| Constraint points from returned candidates | 1/6 | 3/6 |
| Provider-call failures | 0 | 0 |
| Calls | 24 | 24 |
| Prompt tokens | 21,032 | 20,531 |
| Output tokens | 3,774 | 3,000 |
| Total arm time | 71,799 ms | 67,108 ms |

All pair arms ended in deadlock; all single arms were invalid. On the first
task, the pair produced correct values but did not obtain complete agreement.
On other tasks, reviews sometimes accepted a reference as if it multiplied
the target value. Deterministic checks prevented invalid candidates from
becoming ready. The pair's additional constraint points do not satisfy the
predeclared advantage criterion. This trial demonstrates **no collaboration
advantage**; small token/time differences are not subscription-savings evidence.
No task was retried or discarded. The narrow development pass did not transfer
to reliable completion of these new briefs.

### Governed host recovery qualification

The opt-in [governed host bridge](GOVERNED_HOST.md) was exercised through the
existing consensus engine with host-configured `gpt-5.6-sol`, low reasoning,
fresh ephemeral sessions, two rounds and an eight-call ceiling. This used the
already consumed outer-breakpoint brief, not a new comparison task.

Both independent original proposals correctly produced 720px and 1440px.
After preserving the originals, the harness deliberately replaced one role's
extra-large value with `{layout.breakpoint.md}`, a defect from a saved failure.
The deterministic evaluator and counterpart review rejected it. Both roles
then revised; both final reviews accepted the same corrected candidate hash:
`2191d053834ba3b8f61361b2b40ec41cbed3f1ffec4011d9c4ccabed5422738c`.

All eight calls completed without retries: two proposals, two cross-reviews,
two revisions and two final reviews. The engine reached `CONSENSUS` in round
two with no deterministic errors. Old candidate approvals failed against the
revised hash, and the human release gate remained closed.

| Recovery measurement | Observed |
| --- | ---: |
| Wall time | 110,265 ms |
| Input tokens, including cached subset | 197,533 |
| Cached input tokens | 125,440 |
| Output tokens | 886 |
| Token-rate estimated credits | 8.9067 |

This qualifies the complete recovery path on one consumed case, including a
synthetic fault; it does not establish general model reliability or a
collaboration advantage. There was no single-agent baseline in this run.
Credit estimates are not billing or weekly-limit measurements, and host model
configuration is not provider attestation. The original correct proposals
must not be presented as model failures.

### Six-case governed-host comparison

A subsequent frozen comparison used six previously unused compound briefs:
typography chains, spacing and alias exceptions, motion and array types,
responsive grid rules, semantic references, and control-size exceptions. There
were 34 exact constraints per workflow. Both workflows used host-configured
`gpt-5.6-sol` at medium reasoning, fresh ephemeral sessions, the same task
context, and deterministic evaluation. Pair proposals were independent.

Each arm had the same eight-call, 120,000-prompt-character, 16,000-response-character
and 600-second ceilings; individual calls had a 120-second timeout. The requested
2,000-output-token bound was a prompt instruction, not a hard generation limit.
Execution order alternated across cases. Successful arms stopped early. No case
was retried, discarded, or given an injected defect.

Case fingerprint:
`e971ea470cd016c527ff798e9f93de785aa255f23451d40703906268a39a2699`.
Canonical fingerprint:
`e8477233ec9a12e953b2d40aababa57b68c593cf27aebdda62895038035cb99c`.
Runner fingerprint:
`fce677a4f3786e26e8f993c164ef81c46947229e77e7fe0a2847ef8a5e0a4121`.

| Measure | Single | Pair |
| --- | ---: | ---: |
| Valid complete outcomes | 6/6 | 6/6 |
| Exact constraint points | 34/34 | 34/34 |
| Provider-call failures | 0 | 0 |
| Calls | 12 | 24 |
| Input tokens, including cached subset | 302,992 | 605,852 |
| Cached input tokens | 220,928 | 431,360 |
| Output tokens | 3,112 | 6,521 |
| Total arm time | 153,511 ms | 318,095 ms |
| Token-rate estimated credits | 11.97168 | 25.02330 |

All 36 calls returned final usage counters and settled reservations. Each pair
reached exact-candidate-hash consensus after its two initial proposals and two
cross-reviews; each single completed after one proposal and one self-review.
No repairs were needed in these cases, so this run does not add fresh repair
evidence to the consumed-case recovery qualification above.

The predeclared advantage criterion required strictly more valid complete
outcomes, strictly more constraint points, and no more provider failures for the
pair. It was not met: **no collaboration advantage was demonstrated**. The
single workflow achieved the same measured outcomes with fewer calls and lower
observed time and estimated cost. These six synthetic briefs do not establish
general design quality, visual fidelity, or real developer usefulness. Caching,
execution order and serving conditions can affect time and cost. Credit estimates
are neither billing totals nor subscription-limit measurements. Model identity
is host-configured, not independently attested.

A subsequent [selective-review investigation](SELECTIVE_REVIEW_STUDY.md) used
eight fresh cases and shared-branch replay. Selective review retained 8/8 correct
outcomes with 33 calls versus 40 for always-pair; single review also achieved 8/8
with 28 calls. This measured an efficiency benefit relative to always-pair, with
no demonstrated quality advantage over the single continuation.


### Later coupled-migration comparison

A later frozen eight-case run used the same host-configured model and medium
reasoning for both workflows. Case fingerprint:
`514ceaf62471273decbfaf18ec5d7b003f413d9f90f2f2d53a151771fa7f6ad4`.

| Measure | Single | Pair |
| --- | ---: | ---: |
| Correct complete outcomes | 8/8 | 7/8 |
| Feasible constraint points | 51/51 | 51/51 |
| Provider-call failures | 0 | 0 |
| Calls | 16 | 36 |

The positive criterion was not met. Both satisfied all measured feasible field
constraints, but that alone did not establish complete workflow success. These
results precede the later review-scope and issue-identity changes and are not
recomputed after those changes. Subsequent protocol fixes and uptake checks do
not retroactively change this result or establish comparative superiority.
