# Small developer pilot

## Question

Can a developer use canonical design rules and rendered findings to fix useful
UI defects with less manual intervention, while preserving the intended design?

## Scope

Recruit 3–5 consenting repository owners after internal verification and release
review. Start with static interfaces compatible with the documented verifier.
Include different layouts and interaction paths. Use synthetic inputs. Keep raw
source, screenshots, local paths and any personal data private unless an owner
explicitly authorizes sharing. Do not treat internal fixtures as external users.

## Per-repository trial

1. Record the exact source revision, supported scope and developer's intended outcome.
2. Let the developer attempt setup from the documentation; record time and help needed.
3. Run a baseline check. Have the developer label each finding useful, incorrect,
   unclear, or outside scope. Inspect misses, not just reported failures.
4. Let the coding agent propose a bounded repair. Record acceptance, changes outside
   scope, manual edits, recheck result and whether the visual intent was preserved.
5. Ask the developer to repeat on another change. Record actual repeat use; intention
   to use is a separate response.

## Measures

| Measure | Record |
| --- | --- |
| Setup | Minutes, blockers, configuration edits, assistance |
| Findings | Useful / incorrect / unclear / unsupported counts, with denominators |
| Repairs | Accepted unchanged / manually edited / rejected / regressed |
| Coverage | Targets and states checked, missing coverage, known missed defects |
| Efficiency | Agent calls/tokens where observable, elapsed time, human intervention |
| Continued use | A second completed use and developer explanation |

Do not convert token counts into subscription percentages or monetary savings
without authoritative billing evidence. Small samples are qualitative evidence.

## Decision rules

Proposed pilot exit conditions: at least three completed repository trials; no
unresolved source-loss or privacy defect; every observed false pass investigated;
at least two developers complete a second useful repair without live setup help.
Report exact counts and failures. These thresholds guide a next investment
decision; they are not statistical validation or a market-size estimate.

If setup repeatedly needs code changes, improve configuration first. If findings
are mostly irrelevant or repairs harm intent, narrow coverage before expanding.
If users get useful repeat value, consider distribution and support next.

## Rendered design review

Review before/after screenshots at the same viewport and state. Ask the developer
to judge hierarchy, readability, spacing, consistency, fidelity to the brief and
regressions. Record preference with reasons and uncertainty. Keep those judgments
separate from measured rule violations; do not combine them into a universal
"design quality" score. Multi-agent superiority remains an unproven hypothesis.
