# Specification review and pending implementation checks

## Stable caller issue identity

To retain a known concern without depending on model wording, add caller-owned
issues to the review scope:

```json
{
  "stage": "specification",
  "pendingChecks": [{
    "id": "target-measurement",
    "requirement": "Controls have usable pointer targets.",
    "evidenceRequired": "Rendered bounding-box measurements."
  }],
  "issues": [{"id": "target-size", "text": "Rendered target dimensions remain unmeasured."}]
}
```

The host retains this exact issue in every proposal and later review, even when
the model omits it. IDs and text are immutable within a run and included in the
candidate hash. IDs must be unique; two caller IDs cannot have identical text.
Changing either requires a new candidate and reviews. Issue IDs and check IDs
identify different things: a concern and the evidence required to assess it.

Models may add `issueNotes: [{"issueId":"target-size","note":"Measure the compact control too."}]`
to proposals and revisions. Notes are unverified explanations, not issue
definitions or dispositions. The host collapses only exact duplicate ID/note
pairs, preserves differing explanations across rounds, and returns them in
`ConsensusRun.issueNotes`. Limits are 50 caller issues, 100 notes per proposal
and 100 unique notes per run; exceeding a limit fails explicitly without truncation.

Governed-host and Ollama reviews use `issue:target-size` as the structured
`issueReviews` key; legacy concerns keep indexed keys. Deferred evidence includes
both canonical `issue` text and its `issueId`. Reviewers still choose the pending
check explicitly; declaring an issue does not automatically defer or resolve it.
Direct reviews with missing caller concerns or unknown IDs are rejected.

Existing string-based `unresolved` inputs remain supported. New concerns belong
there; explanations about known IDs belong in `issueNotes`. Similar strings are
never merged heuristically: legacy prose variants can still remain separate.
This prevents duplicate growth for structured identity without discarding a
distinct concern. Exact duplicate legacy strings are retained once.

## Pending implementation checks

A specification agreement does not establish that a rendered application meets
its rules. Callers can now make that boundary explicit before proposal generation:

```json
{
  "reviewScope": {
    "stage": "specification",
    "pendingChecks": [
      {
        "id": "focus-adjacency",
        "requirement": "Focus indicators have at least 3:1 contrast against adjacent surfaces.",
        "evidenceRequired": "Browser measurements for each affected control and surface."
      }
    ]
  }
}
```

Supply this optional field in `DesignContext` for `runConsensus`, or in the
authenticated `generate_style_constitution_candidate` MCP request. It applies
unchanged to both independent proposals, cross-reviews and revisions. Omitting
the field preserves the previous candidate shape and hashes.

## What each stage requires

| Stage | Required evidence | Outcome |
| --- | --- | --- |
| Specification review | Proposed values and aliases, supplied canonical rules, deterministic validation, complete reviews of the exact candidate, explicit resolution of every recorded issue | Specification agreement only |
| Implementation verification | Actual browser observations described in each caller-defined pending check | Remains pending; this model workflow cannot perform or certify it |

The scope is a trusted caller contract, not a model-selected exception. Define it
before running the workflow. The model cannot replace the contract or mark a check
verified. A specification defect still blocks agreement, even if it relates to a
pending implementation check. Contradictory requirements still trigger
`NEEDS_CLARIFICATION`. Existing unresolved issues are carried through revisions;
scope does not automatically reclassify or remove them.

## Deferring an open concern

Reviewers can explicitly link an unresolved implementation concern to an existing
caller-defined check. In structured provider output, the entry for that issue is:

```json
{
  "verdict": "deferred",
  "checkId": "focus-adjacency",
  "reason": "This concern needs the declared browser measurements; the specification change satisfies its requirements."
}
```

The normalized review API uses `deferredIssues: [{ issue, checkId, reason }]`, where
`issue` is the exact recorded unresolved string. Both roles must defer the same
issue to the same check on the current candidate. Deferral versus resolution, or
different check IDs, does not constitute agreement. Missing, duplicate, invented
or conflicting dispositions fail closed. Actual specification defects still need
blocking objections and correction; deferral cannot suppress evaluator errors or
a clarification request.

The concern stays in the accumulated issue list and must be reviewed again after
any revision. `reviewReadiness.deferredIssues` retains reviewer, proposal ID,
candidate hash, check ID, reason, `status: "open"` and `evidenceKind: "unverified"`.
The list describes current-candidate review claims, including disagreements on
partial runs; only `CONSENSUS` establishes dual agreement. MCP candidate status
retains the evidence and manual re-merging of the same stored candidate preserves
it. No check becomes complete and no release permission is added.

The model's classification can still be wrong. A valid check ID proves that the
caller declared the obligation, not that every related concern is safe to defer.

## Results and release boundary

- The candidate and initial proposals retain `reviewScope`. Scope and every pending
  evidence requirement participate in the candidate SHA-256. Scope changes require
  new reviews and approvals. Proposals with different scopes cannot be merged.
- Runs and MCP candidate status include `reviewReadiness`, with the candidate hash,
  scope stage, `renderedVerified: false`, and each check marked `pending`.
- Manual merging of stored scoped proposals preserves the contract. Clarification
  holds retain it across journal restore. Ordinary candidate records remain
  process-local, as before.
- The MCP release operation rejects candidates with pending checks, even after
  role and human approval. This slice supplies no completion or waiver API. A
  separate evidence-bound implementation verification workflow is needed to
  discharge them. Removing a check or starting an unscoped run is not verification.
- `CONSENSUS` means agreement within the declared specification scope. An empty
  pending list, or no scope, does not imply rendered verification. The lower-level
  `canRelease` helper checks credentials/approvals only; the service applies the
  pending-check guard at the actual release boundary.

Caller scoping and model reasoning can still be mistaken. Deterministic regressions
verify contract retention and guards, not semantic classification accuracy, visual
quality, live model uptake, or a collaboration advantage.
