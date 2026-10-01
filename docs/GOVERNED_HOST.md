# Governed host integration

`createGovernedHostInvoker` connects a metered host transport to the existing
`ConfigurableAgent` and `runConsensus` interfaces. Logical roles and model names
remain caller-configured. This is an opt-in integration API; the public MCP
endpoint does not expose host execution.

The caller supplies `dispatch(request)`. Each frozen request contains a unique
`callId`, role, model, task, structured prompt and response schema. Dispatch must:

- Obtain authorization for the task packet and estimated usage.
- Reserve usage before inference and settle from trustworthy host counters.
- Start an isolated, read-only session for each call without prior call history.
- Enforce a timeout and retain a private receipt, including failed calls.
- Return the governor receipt with completed status, matching call/model identity,
  input/cached/output token counts, estimated credits and their cost basis,
  settled budget, activity counts, and the JSON answer.

The adapter serializes calls to permit one outstanding reservation. Initial
proposal prompts remain independent: neither contains the counterpart output.
The default ceiling is eight calls and 12,000 response characters. Limits are
configurable; there are no automatic retries. Invalid receipts, unknown usage,
unsettled budgets, missing assistant completion, unexpected host activity, invalid
JSON, malformed proposals and malformed reviews
stop subsequent dispatches from that invoker. Create a new invoker only after
resolving the failure and its usage record.

Proposal shape and path checks run inside the serialized boundary, before the
next dispatch. Provided tradeoff, unresolved-issue and review collections must
have the expected array types; malformed collections cannot become empty lists.
Structured review acceptance requires an explanation for non-scalar values too.

The caller is a trusted boundary: the adapter validates receipt fields but cannot
attest that a transport told the truth or identify the provider's serving model.
Schema text in a prompt does not imply provider-enforced constrained decoding.
Estimated credits are accounting estimates, not a bill or weekly quota measure.
The response character limit is checked after inference, not a generation cap.

Candidate normalization, deterministic evaluation, complete exact-hash reviews,
bounded repair rounds and human release approval continue through the existing
workflow. Tests in `tests/governed-host.test.mjs` use deterministic receipts and
cover the complete cycle without external model calls.

For specification-only reviews with later browser obligations, pass the explicit
[review scope](REVIEW_SCOPE.md). Both role prompts receive the same caller-owned
contract. Pending checks remain in the hash-bound candidate and block MCP release;
model output cannot mark them verified.
