import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOllamaInvoker, OllamaAdapter } from '../dist/packages/provider-adapters/src/index.js';
import { runConsensus, sha256 } from '../dist/packages/consensus-engine/src/index.js';
import { evaluateSpec } from '../dist/packages/evaluator/src/index.js';
import { deepClone } from '../dist/packages/style-spec/src/index.js';
import { loadCanonical } from './load-spec.mjs';

export function briefErrors(candidate, baseline) {
  if (candidate.changes.length !== 1 || candidate.changes[0].path !== 'tokens.radius.md.$value') return ['Change exactly the medium radius token value'];
  const value = candidate.changes[0].value;
  if (typeof value !== 'string' || !/^\d+px$/.test(value)) return ['Use an integer pixel radius'];
  const radius = Number(value.slice(0, -2));
  return radius > Number(baseline.slice(0, -2)) && radius <= 16 ? [] : ['Radius must be softer than the baseline and no larger than 16px'];
}

export async function compareLocalDesign() {
  const canonical = await loadCanonical();
  const context = { baseVersion: canonical.manifest.version,
    brief: 'Make settings controls slightly softer without changing colors, dimensions, focus, or behavior. Change exactly the existing medium radius value. Choose an integer pixel value larger than the baseline but at most 16px. Explain the tradeoff; do not claim visual or accessibility tests ran.',
    criteria: ['one existing radius token only', 'preserve every accessibility rule', 'explain the visual tradeoff'],
    referenceSpec: { tokens: { radius: canonical.tokens.radius } } };
  const evaluate = candidate => {
    const errors = briefErrors(candidate, canonical.tokens.radius.md.$value);
    if (errors.length) return errors;
    const tokens = deepClone(canonical.tokens); tokens.radius.md.$value = candidate.changes[0].value;
    return evaluateSpec({ ...canonical, tokens }).issues.filter(x => x.severity === 'error').map(x => `${x.code}: ${x.message}`);
  };
  const arms = [];
  for (const mode of ['single', 'pair']) {
    const calls = []; const started = Date.now(); let result; let error;
    const maxCalls = mode === 'single' ? 3 : 6;
    const maxOutputPerCall = mode === 'single' ? 800 : 400;
    const invoke = createOllamaInvoker({ numPredict: maxOutputPerCall, timeoutMs: 120000, fetchImpl: async (url, init) => {
      if (calls.length >= maxCalls) throw new Error('Comparison call budget exhausted');
      const body = JSON.parse(init.body); const receipt = { model: body.model, limit: maxOutputPerCall }; calls.push(receipt);
      const start = Date.now();
      const response = await fetch(url, init);
      const data = await response.clone().json();
      Object.assign(receipt, { elapsedMs: Date.now() - start, promptTokens: data.prompt_eval_count ?? null, outputTokens: data.eval_count ?? null, doneReason: data.done_reason ?? null });
      return response;
    } });
    const a = new OllamaAdapter('astra', 'gemma3:4b', invoke);
    const b = new OllamaAdapter('fable', 'llama3.2:3b', invoke);
    try {
      if (mode === 'pair') result = await runConsensus({ astra: a, fable: b, context, maxRounds: 1, evaluate });
      else {
        const initial = await a.generateProposal(context);
        const critique = await a.critiqueProposal(initial, context);
        const revised = await a.reviseProposal(initial, critique, context, 1);
        const candidate = { baseVersion: revised.baseVersion, changes: revised.changes };
        const evaluationErrors = evaluate(candidate);
        result = { status: evaluationErrors.length ? 'INVALID' : 'VALID_CANDIDATE', initial, critique, candidate, candidateHash: await sha256(candidate), evaluationErrors };
      }
    } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
    arms.push({ mode, maxCalls, maxOutputPerCall, totalOutputCap: maxCalls * maxOutputPerCall, elapsedMs: Date.now() - started, calls, result: result ?? null, error: error ?? null });
    console.log(JSON.stringify({ mode, status: result?.status ?? 'ERROR', calls: calls.length, elapsedMs: Date.now() - started, error }));
  }
  return { schemaVersion: 1, kind: 'bounded-local-feasibility-comparison', context, arms,
    limitations: ['One brief and one run per arm; no statistical or aesthetic superiority claim.', 'Equal output caps, not equal actual tokens or input budgets.', 'Models differ across arms; this does not isolate the causal effect of agent count.', 'Single valid candidate is not consensus or release authorization.', 'No rendered candidate evaluation in this model comparison; separate browser fixtures cover UI behavior.'], published: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Provide a private output path');
  const output = await open(process.argv[2], 'wx'); // Reserve before spending any inference budget.
  try { await output.writeFile(JSON.stringify(await compareLocalDesign(), null, 2) + '\n'); }
  finally { await output.close(); }
}
