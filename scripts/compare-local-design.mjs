import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOllamaInvoker, OllamaAdapter } from '../dist/packages/provider-adapters/src/index.js';
import { runConsensus, sha256 } from '../dist/packages/consensus-engine/src/index.js';
import { evaluateSpec } from '../dist/packages/evaluator/src/index.js';
import { deepClone, setPath } from '../dist/packages/style-spec/src/index.js';
import { loadCanonical } from './load-spec.mjs';

export function briefErrors(candidate, baseline) {
  if (candidate.changes.length !== 1 || candidate.changes[0].path !== 'tokens.radius.md.$value') return ['Change exactly the medium radius token value'];
  const value = candidate.changes[0].value;
  if (typeof value !== 'string' || !/^\d+px$/.test(value)) return ['Use an integer pixel radius'];
  const radius = Number(value.slice(0, -2));
  return radius > Number(baseline.slice(0, -2)) && radius <= 16 ? [] : ['Radius must be softer than the baseline and no larger than 16px'];
}

export const comparisonCases = [
  {id:'radius',group:'radius',path:'tokens.radius.md.$value',minimum:12,maximum:16,brief:'Soften medium corners: change only tokens.radius.md.$value to an integer pixel value from 12px through 16px. Preserve every other token and behavior.'},
  {id:'control-size',group:'size',path:'tokens.size.control.md.$value',minimum:48,maximum:48,brief:'Increase medium control size: change only tokens.size.control.md.$value to exactly 48px. Preserve small and large control tokens and all accessibility rules.'},
  {id:'spacing',group:'space',path:'tokens.space.4.$value',minimum:20,maximum:20,brief:'Increase one spacing step: change only tokens.space.4.$value to exactly 20px. Preserve every other spacing value, color, radius and behavior.'}
];

export function evaluateBrief(candidate,definition,canonical) {
  if(candidate.baseVersion!==canonical.manifest.version)return ['Wrong base version'];
  if(!Array.isArray(candidate.changes)||candidate.changes.length!==1||candidate.changes[0].path!==definition.path)return ['Change exactly the requested existing token'];
  const value=candidate.changes[0].value;
  if(typeof value!=='string'||!/^\d+px$/.test(value)||Number(value.slice(0,-2))<definition.minimum||Number(value.slice(0,-2))>definition.maximum)return ['Requested value constraint failed'];
  const modified=deepClone(canonical);setPath(modified,definition.path,value);
  return evaluateSpec(modified).issues.filter(issue=>issue.severity==='error').map(issue=>`${issue.code}: ${issue.message}`);
}

/** Same model and upper call/output budgets. Measured actual usage is not assumed equal. */
export async function compareDesignSuite({model,invoke,maxCases=3,maxCalls=6,outputPerCall=400,maxDurationMs=80000,onArm=()=>{}}={}) {
  if(typeof model!=='string'||!model.trim())throw new Error('Choose an already-installed local model explicitly');
  if(!Number.isInteger(maxCases)||maxCases<1||maxCases>3||!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>6||!Number.isInteger(outputPerCall)||outputPerCall<100||outputPerCall>800||maxDurationMs<1000||maxDurationMs>600000)throw new Error('Invalid comparison budget');
  const canonical=await loadCanonical(),sourceSha256=await sha256(canonical),arms=[];
  for(const [caseIndex,definition] of comparisonCases.slice(0,maxCases).entries())for(const mode of caseIndex%2?['pair','single']:['single','pair']) {
    const context={baseVersion:canonical.manifest.version,brief:definition.brief,criteria:['Preserve unrelated rules','Meet the exact bounded brief','Do not claim browser tests ran'],referenceSpec:{tokens:{[definition.group]:canonical.tokens[definition.group]}}};
    const calls=[];let result,error,queue=Promise.resolve(),characters=0;
    const armStart=Date.now();
    const execute=request=>{
      const pending=queue.then(async()=>{
        if(calls.length>=maxCalls||Date.now()-armStart>=maxDurationMs)throw new Error('Comparison budget exhausted');
        const call={task:request.task,role:request.role,model:request.model,outputCap:outputPerCall};calls.push(call);
        const callStart=Date.now();
        try{
          if(invoke){const data=await invoke(request);call.output=data;return data;}
          const local=createOllamaInvoker({numPredict:outputPerCall,timeoutMs:Math.max(1,Math.min(45000,maxDurationMs-(Date.now()-armStart))),fetchImpl:async(url,init)=>{
            const body=JSON.parse(init.body);characters+=body.prompt.length;
            if(characters>48000)throw new Error('Comparison input-character budget exhausted');
            const response=await fetch(url,init);const data=await response.clone().json();
            Object.assign(call,{promptTokens:data.prompt_eval_count??null,outputTokens:data.eval_count??null,doneReason:data.done_reason??null,rawOutput:data.response??null});
            return response;
          }});
          return await local(request);
        }catch(failure){call.error=String(failure.message??failure);throw failure;}
        finally{call.elapsedMs=Date.now()-callStart;}
      });
      queue=pending.catch(()=>{});return pending;
    };
    const a=new OllamaAdapter('astra',model,execute),b=new OllamaAdapter('fable',model,execute);
    const evaluate=candidate=>evaluateBrief(candidate,definition,canonical);
    try{
      if(mode==='pair')result=await runConsensus({astra:a,fable:b,context,maxRounds:1,evaluate});
      else {
        const initial=await a.generateProposal(context);let proposal=initial;
        for(let round=1;round<=2;round++) {
          const critique=await a.critiqueProposal(proposal,context);
          proposal=await a.reviseProposal(proposal,critique,context,round);
        }
        const finalCritique=await a.critiqueProposal(proposal,context);
        const candidate={baseVersion:proposal.baseVersion,changes:proposal.changes},evaluationErrors=evaluate(candidate);
        result={status:evaluationErrors.length?'INVALID':finalCritique.objections.some(o=>o.severity==='blocking')?'UNRESOLVED':'VALID_CANDIDATE',candidate,candidateHash:await sha256(candidate),evaluationErrors,initial,finalCritique};
      }
    }catch(failure){error=String(failure.message??failure);}
    await queue; // Retain the outcome of already queued counterpart calls before closing this arm.
    const arm={caseId:definition.id,mode,model,maxCalls,outputPerCall,outputCap:maxCalls*outputPerCall,inputCharacterCap:48000,inputCharacters:characters,timeBudgetMs:maxDurationMs,elapsedMs:Date.now()-armStart,calls,result:result??null,error:error??null};
    arms.push(arm);await onArm(arm);
  }
  const summary=Object.fromEntries(['single','pair'].map(mode=>{
    const group=arms.filter(arm=>arm.mode===mode),calls=group.flatMap(arm=>arm.calls);
    const total=field=>calls.length&&calls.every(call=>Number.isFinite(call[field]))?calls.reduce((sum,call)=>sum+call[field],0):null;
    return [mode,{attempts:group.length,validCandidates:group.filter(arm=>['VALID_CANDIDATE','CONSENSUS'].includes(arm.result?.status)).length,consensus:group.filter(arm=>arm.result?.status==='CONSENSUS').length,errors:group.filter(arm=>arm.error).length,calls:calls.length,promptTokens:total('promptTokens'),outputTokens:total('outputTokens'),elapsedMs:group.reduce((sum,arm)=>sum+arm.elapsedMs,0)}];
  }));
  return {schemaVersion:1,kind:invoke?'deterministic-harness-test':'bounded-local-feasibility-comparison',sourceSha256,model,arms,summary,published:false,
    limitations:['Three synthetic token briefs at most, one attempt per arm; no general or aesthetic superiority claim.','Same model and equal call/output ceilings; actual input/output usage and review schedules can differ.','Single uses self-review; pair uses independent initial proposals and cross-review with one bounded round.','Arm order alternates by case; caching, warmup and deterministic sampling remain confounders.','No rendered candidate evaluation or release permission. Deterministic agent tests prove the harness only.']};
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
  try { const result=process.argv[3]==='--suite'?await compareDesignSuite({model:process.argv[4],onArm:arm=>console.log(JSON.stringify({caseId:arm.caseId,mode:arm.mode,status:arm.result?.status??'ERROR',calls:arm.calls.length,error:arm.error}))}):await compareLocalDesign();await output.writeFile(JSON.stringify(result,null,2)+'\n'); }
  finally { await output.close(); }
}
