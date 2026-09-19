import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { StyleService } from '../dist/apps/mcp-server/src/service.js';
import { createConfiguredAgent } from '../dist/packages/provider-adapters/src/index.js';
import { loadCanonical } from './load-spec.mjs';

const astraModel = process.argv[4] ?? process.env.ASTRA_MODEL ?? 'gemma3:4b';
const fableModel = process.argv[5] ?? process.env.FABLE_MODEL ?? 'llama3.2:3b';
const maxRounds = Number(process.argv[3] ?? 1);
if (astraModel === fableModel) throw new Error('Use two distinct local model identifiers for the independent trial');
if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 3) throw new Error('Trial rounds must be 1 to 3');
const localEnv = {
  ASTRA_PROVIDER: 'ollama', ASTRA_MODEL: astraModel,
  FABLE_PROVIDER: 'ollama', FABLE_MODEL: fableModel,
  ASTRA_TIMEOUT_MS: process.env.ASTRA_TIMEOUT_MS,
  FABLE_TIMEOUT_MS: process.env.FABLE_TIMEOUT_MS,
  ASTRA_NUM_PREDICT: process.env.ASTRA_NUM_PREDICT,
  FABLE_NUM_PREDICT: process.env.FABLE_NUM_PREDICT,
};
const canonical = await loadCanonical();
const service = new StyleService({ ...canonical, patterns: [], antiPatterns: {}, decisions: {} });
const started = Date.now();
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
const worktreeDirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no']).toString().trim().length > 0;
const brief = 'A settings interface should feel slightly warmer while retaining the existing accessible color system. Propose exactly one change: set the existing tokens.radius.md.$value to 12px. Do not change any other path or release metadata.';
let run;
let failure;
try {
  run = await service.generateCandidateFromBrief({
    brief,
    criteria: ['one existing token leaf change only', 'preserve color contrast and focus rules', '12px medium radius', 'no release action'],
    maxRounds,
    astra: createConfiguredAgent('astra', localEnv),
    fable: createConfiguredAgent('fable', localEnv),
  }, 'local-trial', 'local-trial');
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
}
const evidence = {
  kind: 'local-provider-consensus-trial',
  at: new Date().toISOString(),
  sourceCommit,
  worktreeDirty,
  models: { astra: astraModel, fable: fableModel },
  elapsedMs: Date.now() - started,
  maxRounds,
  status: run?.status ?? 'ERROR',
  rounds: run?.rounds ?? 0,
  independentInitialProposals: run?.initial ?? [],
  crossCritiques: run?.critiques ?? [],
  candidate: run?.candidate ?? null,
  candidateHash: run?.candidateHash ?? null,
  conflicts: run?.conflicts ?? [],
  evaluationErrors: run?.evaluationErrors ?? [],
  ...(failure ? { failure } : {}),
  published: false,
  canonicalSpecChanged: false,
};
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: evidence.status, rounds: evidence.rounds, candidateHash: evidence.candidateHash, conflicts: evidence.conflicts.length, evaluationErrors: evidence.evaluationErrors.length, elapsedMs: evidence.elapsedMs, ...(failure ? { failure } : {}) }));
