# Bounded collaboration comparison

The comparison asks whether a two-role workflow can complete the same constrained
token briefs as one role using self-review. It does not assume that collaboration
improves results.

## Protocol

- Three fixed synthetic briefs: medium radius from 12px through 16px, medium
  control size exactly 48px, and spacing step 4 exactly 20px. Each permits one
  existing token change and requires all other rules to remain intact.
- Both arms start from the same canonical source and use the same explicitly
  selected installed model. Astra and Fable are logical roles.
- Each arm has at most six calls, 400 output tokens per call by default, 48,000
  prompt characters and a fresh 80-second time allowance. Actual token counts,
  failures and latency are recorded. No automatic model download is performed.
- The single arm proposes, self-reviews and revises twice, then obtains a final
  critique. The pair uses independent initial proposals, cross-review and one
  bounded consensus round. These review schedules differ.
- Deterministic brief constraints and the StyleSpec evaluator check candidates.
  Pair consensus also requires the existing exact-candidate agreement rules.
- Arm order alternates by brief. All attempted arms stay in the denominator;
  provider/parsing failures are not discarded.

Run after compiling the core packages, with an already running local Ollama
endpoint and installed model:

```sh
node scripts/compare-local-design.mjs /private/new-result.json --suite <installed-model>
```

The output path must be new. Raw outputs are retained locally and may contain
model-generated content. Do not upload private receipts without review.

## Evidence limits

The first live rehearsal on 29 September 2026 used `gemma3:4b`, three briefs and
one attempt per arm. Neither arm produced a valid candidate: single **0/3**, pair
**0/3**. Truncated JSON and unsupported proposal paths caused the failures. The
pair consumed more recorded tokens. This supports no claim of a collaboration
advantage under those settings.

That rehearsal used a shared eight-minute time ceiling; it completed in about
46 seconds without reaching that ceiling. Review then identified a potential
ordering bias if later runs exhausted it. The harness now gives every arm a fresh
equal time allowance, with a delayed-first-arm regression proving that the next
arm retains its allowance. Keep receipts from different harness revisions
separate.

Deterministic mock successes prove harness behavior only. Three synthetic briefs
do not establish aesthetic quality, model rankings, real developer adoption or
general superiority. Warmup, caching, tokenization and review schedules remain
confounders. Local model token counts are not Codex usage credits or measured
subscription savings. A valid candidate is not browser verification or permission
to publish.

The next model-quality experiment should address bounded structured-output
reliability, then use fresh held-out briefs. Do not repeatedly tune these three
cases to obtain a favorable result.
