# Selective pair-review investigation

An experimental branch comparison tested whether escalating selected proposals
to the pair could reduce work while preserving measured outcomes. This is
research evidence; selective routing is not implemented in the product.

## Frozen policy and method

Eight new synthetic briefs comprised six feasible changes and two contradictory
requests. Accessibility and reference-graph risks were declared before inference.
Those cases selected pair review immediately. Other cases started with one
proposal and self-review, escalating on canonical evaluation errors or incomplete
review. Hidden expected values were used only for final scoring, never routing
or model feedback. Models could see ordinary canonical validation errors.

Each case used one shared initial Astra proposal and two continuations: single
review and always-on pair review. Fable proposed independently from the original
context. Selective policy was replayed from the applicable recorded branches.
Each logical workflow paid for its own initial work, and escalation included the
spent self-review. This avoided duplicate physical calls but means the policies
are correlated branch comparisons, not three independent trials.

All calls used host-configured `gpt-5.6-sol`, medium reasoning, fresh ephemeral
sessions and no tools. Initial proposals and exact-hash review used the existing
adapter and consensus engine. Single continuation allowed four rounds; pair
allowed two. Both had eight-call ceilings; selective escalation could require
nine calls including the spent self-review. No calls were retried, no cases were
discarded, and no candidate faults were injected. The two conflicts were authored
requests, not naturally observed developer failures.

## Results

| Measure | Single continuation | Always-pair | Selective replay |
| --- | ---: | ---: | ---: |
| Correct outcomes | 8/8 | 8/8 | 8/8 |
| Valid changes | 6 | 6 | 6 |
| Correct holds for contradictions | 2 | 2 | 2 |
| False approvals / provider failures | 0 / 0 | 0 / 0 | 0 / 0 |
| Logical calls | 28 | 40 | 33 |
| Token-rate estimated credits | 16.60670 | 24.02782 | 20.43144 |
| Sum of recorded call time | 296.650 s | 433.862 s | 359.463 s |

Selective replay used **17.5% fewer calls** and approximately **15.0% fewer
estimated credits** than always-pair, with equal observed outcomes. It met that
predeclared efficiency criterion. It did **not** improve quality over the single
continuation, which used fewer calls and estimated credits than either policy.

Four routine cases stopped after self-review. Three declared-risk cases selected
the pair. The remaining contradictory request escalated after self-review. All
six completed pair candidates had matching exact-hash reviews; both contradictory
requests remained unapproved. The physical study made 60 calls, costing 35.80206
estimated credits; all returned final counters and settled reservations. Logical
policy totals overlap and must not be added to claim actual experiment usage.

## Limits and implications

- Risk labels were manually assigned from the briefs. An automatic production
  risk classifier has not been built or qualified.
- The shared single continuation retained Astra's systems/maintainability lens.
  It did not use the earlier comparison's combined-lens single prompt. This is
  not a comparison against an independently optimized single-agent workflow.
- Contradictions carried explicit warnings. Correct holds here do not establish
  detection of subtle real-world disagreements or general design quality.
- Both continuations spent repeated revision calls on irreconcilable requests.
  This suggests investigating an explicit clarification state before further
  generation. A model objection alone must not waive canonical requirements.
- Time is summed recorded call time, not deployed-router latency. Caching,
  order and service variation affect measurements. Credit estimates are not
  billing totals or weekly subscription usage; model identity is host-configured.
- A single reviewed draft is advisory. It does not supply two-role consensus
  or bypass the existing human release gate.

These results support further evaluation of selective review as an efficiency
option relative to always-pair. They do not establish a collaboration quality
advantage or justify changing release governance.
