# When requirements need clarification

The consensus engine returns `NEEDS_CLARIFICATION` when a reviewer explicitly
identifies requirements that need a user decision. It completes the current
cross-review and stops before further revisions. Ordinary repairable objections
retain the existing bounded repair workflow.

## Reviewer contract

Reviews may include an optional `clarificationRequests` array. For example:

```json
{
  "clarificationRequests": [{
    "reason": "One duration cannot satisfy two simultaneous exact values.",
    "question": "Which requirement should apply: 210ms or 230ms?",
    "requirements": [
      { "source": "brief", "quote": "Requirement A requires 210ms." },
      { "source": "brief", "quote": "Requirement B requires 230ms." }
    ]
  }]
}
```

The example assumes those exact sentences are in the submitted brief. This field
accompanies the ordinary review fields; it does not replace path or issue review.
Supported sources are `brief`, `criteria` entries and `validation` errors from
the current `deterministicFeedback`. Each request requires a reason, a question
and two to four distinct quotes that occur in the declared source. At most four
requests are allowed; reason/quote text is limited to 1,000 characters and the
question to 500. Malformed or invented evidence is rejected.

Quote grounding verifies provenance, not semantic contradiction. Requests carry
`evidenceKind: "unverified"`. A reviewer may be mistaken, and a provider that does
not emit this field still uses the existing bounded behavior. This is not an
automatic detector of every contradictory natural-language instruction.

## Result and continuation

The result includes the original proposals, both reviews, conflicts, validation
errors, the candidate SHA-256 and `clarification` evidence. Evidence retains each
requesting reviewer, proposal ID, exact reviewed candidate and its hash, plus a
hash of the original context. Conflicting alternatives retain separate hashes.
No requirement is silently waived and no candidate is registered for release.

The authenticated generation service returns the same held result with
`reused: true` when the context is unchanged. No further model calls are made.
Changing only the round limit does not clear a hold. The hold covers the merged
candidate and both reviewed hashes; existing pending approvals are cleared, and
manual promotion, approval and publication are blocked for those hashes. A late
concurrent run on the same context cannot override the recorded hold.
Such an already-running call is not canceled: its usage must still be accounted
for even when the service returns the previously held result.

After the user clarifies the requirements, submit a new brief or criteria. The
service runs fresh independent proposals, exact-hash reviews and deterministic
checks. Only successful consensus clears the resulting candidate's hold; both
role approvals and human release approval are still required. Prior approvals
are not inherited, even if the candidate values happen to be identical.

## Persistent holds

Write-enabled MCP requires `MCP_CLARIFICATION_PATH` on private persistent storage.
Initialize a new journal once after compilation:

```sh
pnpm compile:core
node scripts/init-clarification-store.mjs /private/clarification.jsonl
```

Set `MCP_CLARIFICATION_PATH` to that file before starting the service. Initialization
refuses to overwrite an existing file. Startup refuses missing, incomplete or
corrupt journals. Do not reinitialize to work around an error: restore a known-good
backup and investigate it. Use one writer per journal; this local implementation
does not support distributed or simultaneous multi-process writers.

The journal retains hash-chained snapshots of holds and complete clarification
results, including requirement quotes. Keep it private, outside the public repo,
with restricted directory permissions and backups. Its checks detect corruption
and changes while running; they do not prevent a privileged operator replacing
the journal with a valid older copy. It is not an authenticated external ledger.

Writes are flushed before success is returned. Any storage failure blocks later
governance actions and provider dispatch until restart after recovery. Reopening
restores held hashes and unchanged-context reuse. Candidate and approval registries
remain process-local; successful recovery never restores older approvals. Embedded
`StyleService` callers must explicitly pass a `clarificationStore` to get persistence;
omitting it retains the in-memory behavior for tests and ephemeral use.

A prior released record is not erased or retroactively undeployed; a new hold
prevents subsequent publication actions.

## Verification scope

Deterministic tests cover the core engine, generic and governed-host adapters,
single-agent comparison, and service authority boundaries. They verify stopping,
source grounding, stale hashes, conflicting alternatives, unchanged-input reuse,
concurrent completion, and fresh evaluation. Existing ordinary repair tests remain
in place. These tests do not establish live-model detection rates or measured
subscription savings for this new response field.
