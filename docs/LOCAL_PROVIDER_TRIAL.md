# Optional local Astra and Fable trial

The governed candidate API accepts two distinct local Ollama model identifiers through `ASTRA_PROVIDER=ollama` and `FABLE_PROVIDER=ollama`. The roles remain logical roles. The adapter only permits a loopback `/api/generate` endpoint, requests JSON output, caps generation and time, and requires no provider key. The public MCP deployment does not expose this mutation path.

With Ollama running and both models installed, build the core and run the bounded example from the repository root:

```sh
pnpm compile:core
node scripts/run-local-consensus.mjs trial.json 1 gemma3:4b llama3.2:3b
```

The arguments are output path, maximum rounds (1 to 3), Astra model, and Fable model. The script creates its evidence file once, never changes `/spec`, and never publishes. Its brief asks for one existing medium radius token leaf change. The evidence contains the independent initial proposals, cross critiques, conflicts, deterministic errors, candidate hash if any, and whether the worktree was dirty. An `ERROR` record means the provider call or response validation failed before a completed run; its `failure` field reports the error.

## Exploratory observations, 2026-09-19

These runs used a worktree with uncommitted adapter code and are **observed exploratory evidence**, not release validation. Raw outputs are retained locally with the operator. No paid provider call was made.

| Models and rounds | Result | Observed issue |
| --- | --- | --- |
| gemma3:4b / llama3.2:3b, 1 | `DEADLOCK` | Both first proposals set `tokens.radius.md.$value` to `12px`, then cross critique and revision diverged to `10px` versus `12px`; no candidate. |
| gemma3:4b / llama3.2:3b, 2 | `DEADLOCK` | A critique invented `components.button.tokens.background`; deterministic evaluation rejected that path; no candidate. |
| qwen2.5:7b-instruct / mistral:7b, 1 | Error before candidate | A proposal omitted the required `value`. The adapter now rejects this with a specific validation error. |
| qwen2.5:7b-instruct / llama3.1:8b, 1 | Error before candidate | Before structured output, critique accepted an unproposed path. |
| qwen2.5:7b-instruct / llama3.1:8b, 1 | Error before candidate | With required-field schemas, critique both accepted and blocked the same path. |
| qwen2.5:7b-instruct / llama3.1:8b, 1 | `INVALID` | With one verdict per path, a proposal used slash notation and deterministic evaluation rejected it. |
| qwen2.5:7b-instruct / llama3.1:8b, 2 | `DEADLOCK` | With existing-path enums, proposals used valid paths but disagreed on the value shape. No candidate was created. |

Some model critiques claimed that the radius change affected contrast without evidence. Treat those as model assertions, not verified accessibility findings. A provider-backed successful consensus candidate, stronger critique grounding, and a release-grade repeat remain open work.

These observations drove stricter local output schemas and a discovered evaluator gap: a token leaf's declared `$type` was not enforcing the shape of its `$value`. That evaluator repair is separate required work before any provider result can count as a valid release candidate.
