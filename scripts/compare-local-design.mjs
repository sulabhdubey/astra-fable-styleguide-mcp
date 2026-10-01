import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOllamaInvoker, OllamaAdapter } from '../dist/packages/provider-adapters/src/index.js';
import { runConsensus, candidateFromProposal, reviewReadiness, reviewIsComplete, clarificationForReview, sha256 } from '../dist/packages/consensus-engine/src/index.js';
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

// Development prompts may tune mechanics. Never pool their outcomes with the frozen suite.
export const developmentCases = [
  {id:'radius',groups:['radius'],expectedChanges:[{path:'tokens.radius.md.$value',value:'14px'}],brief:'Change only tokens.radius.md.$value to exactly 14px. Preserve every other token and behavior.'},
  {id:'control-size',groups:['size'],expectedChanges:[{path:'tokens.size.control.md.$value',value:'48px'}],brief:'Change only tokens.size.control.md.$value to exactly 48px. Preserve small and large control tokens and every accessibility rule.'},
  {id:'spacing',groups:['space'],expectedChanges:[{path:'tokens.space.4.$value',value:'20px'}],brief:'Change only tokens.space.4.$value to exactly 20px. Preserve every other spacing value, color, radius, and behavior.'}
];

// Frozen before the first model invocation. These paths were absent from both development suites.
export const comparisonCases = [
  {id:'type-scale',groups:['typography'],expectedChanges:[{path:'tokens.typography.fontSize.300.$value',value:'17px'},{path:'tokens.typography.lineHeight.tight.$value',value:1.25}],brief:'Make dense headings slightly more readable. Change exactly tokens.typography.fontSize.300.$value to 17px and tokens.typography.lineHeight.tight.$value to 1.25. Preserve every other typography value, color, spacing, and component rule.'},
  {id:'responsive-breakpoints',groups:['layout'],expectedChanges:[{path:'tokens.layout.breakpoint.md.$value',value:'800px'},{path:'tokens.layout.breakpoint.lg.$value',value:'1080px'}],brief:'Adjust the middle responsive range. Change exactly tokens.layout.breakpoint.md.$value to 800px and tokens.layout.breakpoint.lg.$value to 1080px. Preserve the small and extra-large breakpoints, grid, spacing, and component rules.'},
  {id:'motion-tempo',groups:['duration'],expectedChanges:[{path:'tokens.duration.fast.$value',value:'100ms'},{path:'tokens.duration.normal.$value',value:'180ms'}],brief:'Tighten interface motion while preserving two distinct timing tiers. Change exactly tokens.duration.fast.$value to 100ms and tokens.duration.normal.$value to 180ms. Preserve easing, motion aliases, accessibility rules, and component behavior.'}
];

// A new suite for the review-before-revision protocol; never pool with the earlier frozen results.
export const readinessCases = [
  {id:'small-control-proportions',groups:['size'],expectedChanges:[{path:'tokens.size.control.sm.$value',value:'44px'},{path:'tokens.size.icon.sm.$value',value:'22px'}],brief:'Change only the small control height and small icon size. Set tokens.size.control.sm.$value to 44px. Set tokens.size.icon.sm.$value to exactly half the NEW small control height, in pixels. Preserve every medium and large size and all other rules.'},
  {id:'compact-grid',groups:['layout','space'],expectedChanges:[{path:'tokens.layout.grid.columns.$value',value:8},{path:'tokens.layout.grid.gutter.$value',value:'{space.3}'}],brief:'Change only grid columns and gutter. Set tokens.layout.grid.columns.$value to two thirds of its reference value, as a JSON number. Set tokens.layout.grid.gutter.$value to a token reference to space.3, not a literal pixel value. Preserve every breakpoint, the spacing scale itself, and all other rules.'},
  {id:'display-type-ratio',groups:['typography'],expectedChanges:[{path:'tokens.typography.fontSize.500.$value',value:'28px'},{path:'tokens.typography.fontSize.700.$value',value:'35px'}],brief:'Change only fontSize.500 and fontSize.700. Increase tokens.typography.fontSize.500.$value by 4px from its reference value. Make tokens.typography.fontSize.700.$value exactly 1.25 times the NEW fontSize.500 value, in pixels. Preserve the three smaller font sizes, line heights, family, and all other rules.'}
];

function sameValue(a,b){return JSON.stringify(a)===JSON.stringify(b);}
export function scoreCandidate(candidate,definition){
  if(!candidate||!Array.isArray(candidate.changes))return 0;
  return definition.expectedChanges.filter(expected=>candidate.changes.some(change=>change.path===expected.path&&sameValue(change.value,expected.value))).length;
}
export function evaluateBrief(candidate,definition,canonical) {
  const errors=[];
  if(candidate.baseVersion!==canonical.manifest.version)errors.push('Wrong base version');
  if(!Array.isArray(candidate.changes))return [...errors,'Changes must be an array'];
  const expected=new Map(definition.expectedChanges.map(change=>[change.path,change.value]));
  if(candidate.changes.length!==expected.size)errors.push(`Change exactly ${expected.size} requested tokens`);
  for(const change of candidate.changes){
    if(!expected.has(change.path))errors.push(`Unexpected change path: ${change.path}`);
    else if(!sameValue(change.value,expected.get(change.path)))errors.push(`Requested value constraint failed: ${change.path}`);
  }
  for(const path of expected.keys())if(!candidate.changes.some(change=>change.path===path))errors.push(`Missing requested change: ${path}`);
  if(errors.length)return errors;
  const modified=deepClone(canonical);
  for(const change of candidate.changes)setPath(modified,change.path,change.value);
  return evaluateSpec(modified).issues.filter(issue=>issue.severity==='error').map(issue=>`${issue.code}: ${issue.message}`);
}

function comparisonContext(canonical,definition){
  const paths=definition.expectedChanges.map(change=>change.path);
  return {
    baseVersion:canonical.manifest.version,
    brief:definition.brief,
    criteria:['Apply every requested change exactly','Preserve all unrelated rules','Review systems and semantic-token consistency','Review accessibility, interaction state, and content clarity','Do not claim browser tests ran'],
    referenceSpec:{tokens:Object.fromEntries(definition.groups.map(group=>[group,canonical.tokens[group]]))},
    proposalContract:{allowedPaths:paths,requiredPaths:paths,minChanges:paths.length,maxChanges:paths.length}
  };
}

export function withinDeadline(work,timeoutMs){
  const deadline=Date.now()+timeoutMs;
  return new Promise((resolve,reject)=>{
    let settled=false;
    const rejectForDeadline=()=>{if(settled)return;settled=true;reject(new Error('Comparison time budget exhausted'));};
    const timer=setTimeout(rejectForDeadline,timeoutMs);
    work.then(value=>{
      if(Date.now()>=deadline){clearTimeout(timer);rejectForDeadline();return;}
      if(settled)return;
      settled=true;clearTimeout(timer);resolve(value);
    },error=>{
      if(Date.now()>=deadline){clearTimeout(timer);rejectForDeadline();return;}
      if(settled)return;
      settled=true;clearTimeout(timer);reject(error);
    });
  });
}

/** Equal ceilings; both workflows stop after complete review or exhaust the declared budget. */
export async function compareDesignSuite({model,invoke,cases=comparisonCases,maxCases=3,maxCalls=8,outputPerCall=400,maxDurationMs=90000,cpuOnly=false,onArm=()=>{},modelMetadata=null,suite='development'}={}) {
  if(typeof model!=='string'||!model.trim())throw new Error('Choose an already-installed local model explicitly');
  if(typeof cpuOnly!=='boolean')throw new Error('cpuOnly must be boolean');
  if(!Array.isArray(cases)||cases.length<1||cases.length>3)throw new Error('Invalid comparison cases');
  if(!Number.isInteger(maxCases)||maxCases<1||maxCases>3||!Number.isInteger(maxCalls)||maxCalls!==8||!Number.isInteger(outputPerCall)||outputPerCall<100||outputPerCall>600||!Number.isInteger(maxDurationMs)||maxDurationMs<1000||maxDurationMs>120000)throw new Error('Invalid comparison budget');
  const canonical=await loadCanonical(),specSha256=await sha256(canonical),arms=[];
  for(const [caseIndex,definition] of cases.slice(0,maxCases).entries())for(const mode of caseIndex%2?['pair','single']:['single','pair']) {
    const context=comparisonContext(canonical,definition);
    const calls=[];let result,error,queue=Promise.resolve(),characters=0;
    const armStart=Date.now();
    const execute=request=>{
      const pending=queue.then(async()=>{
        const remaining=maxDurationMs-(Date.now()-armStart);
        if(calls.length>=maxCalls||remaining<1000)throw new Error('Comparison time or call budget exhausted');
        const effectiveTimeoutMs=Math.min(30000,remaining);
        const call={task:request.task,role:request.role,model:request.model,outputCap:outputPerCall,effectiveTimeoutMs};calls.push(call);
        const callStart=Date.now();
        try{
          if(invoke){const data=await withinDeadline(Promise.resolve().then(()=>invoke(request)),effectiveTimeoutMs);call.output=data;return data;}
          const local=createOllamaInvoker({cpuOnly,numPredict:outputPerCall,maxResponseChars:12000,timeoutMs:effectiveTimeoutMs,fetchImpl:async(url,init)=>{
            const body=JSON.parse(init.body);characters+=body.prompt.length;
            if(characters>48000)throw new Error('Comparison input-character budget exhausted');
            const response=await fetch(url,init);const data=await response.clone().json();
            Object.assign(call,{promptTokens:data.prompt_eval_count??null,outputTokens:data.eval_count??null,doneReason:data.done_reason??null,loadDurationNs:data.load_duration??null,promptDurationNs:data.prompt_eval_duration??null,outputDurationNs:data.eval_duration??null,rawOutput:data.response??null});
            return response;
          }});
          return await withinDeadline(local(request),effectiveTimeoutMs);
        }catch(failure){call.error=String(failure.message??failure);throw failure;}
        finally{call.elapsedMs=Date.now()-callStart;}
      });
      queue=pending.catch(()=>{});return pending;
    };
    const a=new OllamaAdapter(mode==='single'?'single':'astra',model,execute),b=new OllamaAdapter('fable',model,execute);
    const evaluate=candidate=>evaluateBrief(candidate,definition,canonical);
    try{
      if(mode==='pair')result=await runConsensus({astra:a,fable:b,context,maxRounds:2,evaluate});
      else {
        const initial=await a.generateProposal(context);let proposal=initial;
        const recordedIssues=new Set(initial.unresolved);
        for(let round=1;round<=4;round++) {
          for(const issue of proposal.unresolved)recordedIssues.add(issue);
          proposal={...proposal,unresolved:[...recordedIssues]};
          const candidate=candidateFromProposal(proposal);
          const feedback={candidateHash:await sha256(candidate),errors:evaluate(candidate)};
          const reviewContext={...context,deterministicFeedback:feedback};
          const critique=await a.critiqueProposal(proposal,reviewContext);
          const accepted=await reviewIsComplete(critique,proposal,a.id);
          result={status:feedback.errors.length?'INVALID':accepted?'VALID_CANDIDATE':'UNRESOLVED',candidate,candidateHash:feedback.candidateHash,reviewReadiness:reviewReadiness(candidate,feedback.candidateHash,[critique]),evaluationErrors:feedback.errors,initial,finalCritique:critique};
          const requests=await clarificationForReview(critique,proposal,a.id,reviewContext);
          if(requests.length){result={...result,status:'NEEDS_CLARIFICATION',clarification:{contextHash:await sha256(context),requests}};break;}
          if(result.status==='VALID_CANDIDATE'||round===4)break;
          proposal=await a.reviseProposal(proposal,critique,reviewContext,round);
        }
      }
    }catch(failure){error=String(failure.message??failure);result=null;}
    await queue;
    const constraintScore=scoreCandidate(result?.candidate,definition);
    const arm={caseId:definition.id,mode,model,maxCalls,outputPerCall,outputCap:maxCalls*outputPerCall,inputCharacterCap:48000,inputCharacters:characters,timeBudgetMs:maxDurationMs,elapsedMs:Date.now()-armStart,constraintScore,constraintTotal:definition.expectedChanges.length,calls,result:result??null,error:error??null};
    arms.push(arm);await onArm(arm);
  }
  const summary=Object.fromEntries(['single','pair'].map(mode=>{
    const group=arms.filter(arm=>arm.mode===mode),callsForMode=group.flatMap(arm=>arm.calls);
    const total=field=>callsForMode.length&&callsForMode.every(call=>Number.isFinite(call[field]))?callsForMode.reduce((sum,call)=>sum+call[field],0):null;
    return [mode,{attempts:group.length,validCandidates:group.filter(arm=>mode==='pair'?arm.result?.status==='CONSENSUS':arm.result?.status==='VALID_CANDIDATE').length,consensus:group.filter(arm=>arm.result?.status==='CONSENSUS').length,erroredArms:group.filter(arm=>arm.error).length,providerErrors:callsForMode.filter(call=>call.error).length,constraintScore:group.reduce((sum,arm)=>sum+arm.constraintScore,0),constraintTotal:group.reduce((sum,arm)=>sum+arm.constraintTotal,0),calls:callsForMode.length,promptTokens:total('promptTokens'),outputTokens:total('outputTokens'),elapsedMs:group.reduce((sum,arm)=>sum+arm.elapsedMs,0)}];
  }));
  const criterion='Pair has more governance-ready successes, a strictly higher total constraint score, and no more provider-call failures than single.';
  const demonstrated=summary.pair.validCandidates>summary.single.validCandidates&&summary.pair.constraintScore>summary.single.constraintScore&&summary.pair.providerErrors<=summary.single.providerErrors;
  return {schemaVersion:4,kind:invoke?'deterministic-harness-test':suite==='development'?'bounded-local-development-comparison':'bounded-local-frozen-comparison',suite,specSha256,caseSha256:await sha256(cases.slice(0,maxCases)),model,modelMetadata,caseOrder:cases.slice(0,maxCases).map(definition=>definition.id),settings:{cpuOnly,maxCases,maxCalls,outputPerCall,inputCharacterCap:48000,maxDurationMs,totalRunTimeCapMs:maxCases*2*maxDurationMs},arms,summary,advantage:{criterion,demonstrated},published:false,
    limitations:['Three briefs per suite at most and one attempt per arm; no general or aesthetic superiority claim.','Same model and equal call, output, input, and time ceilings; actual token use can differ.','Both arms receive the same brief criteria, proposal contract and hash-bound deterministic feedback. The single role receives both lenses; pair roles specialize while checking all criteria.','Both stop on complete review; single has up to three revisions, pair has independent proposals and up to one revision followed by review of the exact merged candidate.','Arm order alternates by case; caching, warmup, and deterministic sampling remain confounders.','No rendered candidate evaluation or release permission. Deterministic agent tests prove the harness only.']};
}

export async function readLocalModelMetadata(model,fetchImpl=fetch){
  const response=await fetchImpl('http://127.0.0.1:11434/api/tags');
  if(!response.ok)throw new Error(`Ollama tags error ${response.status}`);
  const data=await response.json();
  const found=Array.isArray(data.models)?data.models.find(item=>item?.name===model||item?.model===model):undefined;
  if(!found)throw new Error(`Installed Ollama model not found: ${model}`);
  return {name:found.name??found.model,digest:found.digest??null,modifiedAt:found.modified_at??null,size:found.size??null};
}

export async function readLocalModelLoadState(model,fetchImpl=fetch){
  const response=await fetchImpl('http://127.0.0.1:11434/api/ps');
  if(!response.ok)throw new Error(`Ollama process-state error ${response.status}`);
  const data=await response.json();
  const found=Array.isArray(data.models)?data.models.find(item=>item?.name===model||item?.model===model):undefined;
  if(!found)throw new Error(`Prewarm the selected Ollama model before starting matched arms: ${model}`);
  return {name:found.name??found.model,digest:found.digest??null,sizeVram:found.size_vram??null,expiresAt:found.expires_at??null};
}

export async function writeReceiptCheckpoint(handle,value){
  const encoded=JSON.stringify(value,null,2)+'\n';
  await handle.truncate(0);
  await handle.write(encoded,0,'utf8');
  await handle.sync();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/compare-local-design.mjs <new-private-output.json> <--development|--suite> <installed-model>');
  const output = await open(process.argv[2], 'wx');
  let checkpoint;
  try {
    const mode=process.argv[3],model=process.argv[4],cpuOnly=process.argv[5]==='--cpu';
    if(process.argv[5]&&!cpuOnly||process.argv.length>6)throw new Error('Only the optional --cpu runtime flag is supported');
    if(!['--development','--suite'].includes(mode)||!model)throw new Error('Usage: node scripts/compare-local-design.mjs <new-private-output.json> <--development|--suite> <installed-model>');
    const modelMetadata={...(await readLocalModelMetadata(model)),loadState:await readLocalModelLoadState(model),warmupExcludedFromArms:true};
    if(cpuOnly&&modelMetadata.loadState.sizeVram!==0)throw new Error('Prewarm the CPU-only runtime before using --cpu');
    const cases=mode==='--development'?developmentCases:readinessCases;
    const suite=mode==='--development'?'development':'readiness-v2';
    checkpoint={schemaVersion:4,status:'running',mode,model,modelMetadata,cases,caseSha256:await sha256(cases),settings:{cpuOnly,maxCalls:8,outputPerCall:400,maxDurationMs:90000},completedArms:[],published:false};
    await writeReceiptCheckpoint(output,checkpoint);
    const result=await compareDesignSuite({model,modelMetadata,cpuOnly,cases,suite,onArm:async arm=>{
      checkpoint.completedArms.push(arm);
      await writeReceiptCheckpoint(output,checkpoint);
      console.log(JSON.stringify({caseId:arm.caseId,mode:arm.mode,status:arm.result?.status??'ERROR',constraintScore:`${arm.constraintScore}/${arm.constraintTotal}`,calls:arm.calls.length,error:arm.error}));
    }});
    await writeReceiptCheckpoint(output,{status:'completed',...result});
  } catch(error) {
    await writeReceiptCheckpoint(output,{...(checkpoint??{schemaVersion:4}),status:'aborted',error:String(error?.message??error),published:false});
    throw error;
  } finally { await output.close(); }
}
