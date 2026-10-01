import { canonicalize, deepClone, deepFreeze, isRecord } from '../../style-spec/src/index.js';

export interface ProposalContract { allowedPaths: string[]; requiredPaths?: string[]; minChanges?: number; maxChanges?: number; }
export interface DeterministicFeedback { candidateHash: string; errors: string[]; }
export interface PendingCheck { id:string; requirement:string; evidenceRequired:string; }
export interface ReviewIssue { id:string; text:string; }
export interface IssueNote { issueId:string; note:string; }
export interface ReviewScope { stage:'specification'; pendingChecks:PendingCheck[]; issues?:ReviewIssue[]; }
export interface DeferredIssue { issueId?:string; issue:string; checkId:string; reason:string; }
export interface DeferredIssueEvidence extends DeferredIssue { reviewer:string; proposalId:string; candidateHash:string; status:'open'; evidenceKind:'unverified'; }
export interface ReviewReadiness { stage:'specification'|'unspecified'; candidateHash:string; renderedVerified:false; pendingChecks:(PendingCheck&{status:'pending'})[]; deferredIssues:DeferredIssueEvidence[]; }
export interface DesignContext { brief: string; criteria: string[]; baseVersion: string; referenceSpec?: unknown; reviewScope?:ReviewScope; proposalContract?: ProposalContract; deterministicFeedback?: DeterministicFeedback; reconciliation?: { counterpart: Candidate; conflicts: Conflict[]; }; }
export interface Change { path: string; value: unknown; rationale?: string; }
export interface DesignProposal { id: string; author: string; baseVersion: string; summary: string; changes: Change[]; tradeoffs: string[]; unresolved: string[]; issueNotes?:IssueNote[]; reviewScope?:ReviewScope; }
export interface Objection { path: string; reason: string; severity: 'warning'|'blocking'; evidenceKind?: 'unverified'; }
export interface ClarificationRequest { reason:string; question:string; requirements:{source:'brief'|'criteria'|'validation';quote:string}[]; }
export interface ClarificationEvidence { reviewer:string; proposalId:string; candidateHash:string; reviewedCandidate:Candidate; request:ClarificationRequest; evidenceKind:'unverified'; }
export interface ClarificationState { contextHash:string; requests:ClarificationEvidence[]; }
export interface Critique { reviewer: string; proposalId: string; objections: Objection[]; acceptedPaths: string[]; resolvedIssues?: string[]; issueObjections?: {issue:string;reason:string}[]; deferredIssues?:DeferredIssue[]; clarificationRequests?:ClarificationRequest[]; candidateHash: string; evidenceKind?: 'unverified'; }
export interface DesignAgent { id: string; generateProposal(context: Readonly<DesignContext>): Promise<DesignProposal>; critiqueProposal(proposal: Readonly<DesignProposal>, context: Readonly<DesignContext>): Promise<Critique>; reviseProposal(proposal: Readonly<DesignProposal>, critique: Readonly<Critique>, context: Readonly<DesignContext>, round: number): Promise<DesignProposal>; }
export interface Conflict { path: string; astra: unknown; fable: unknown; }
export interface Candidate { baseVersion: string; changes: Change[]; reviewScope?:ReviewScope; }
export interface Approval { actor: string; candidateHash: string; accepted: true; remainingObjections: string[]; }
export type ConsensusStatus='CONSENSUS'|'PARTIAL_CONSENSUS'|'DEADLOCK'|'INVALID'|'NEEDS_CLARIFICATION';
export interface ConsensusRun { issueNotes?:IssueNote[]; status: ConsensusStatus; rounds: number; initial: [DesignProposal,DesignProposal]; critiques: Critique[]; candidate: Candidate; candidateHash: string; conflicts: Conflict[]; evaluationErrors: string[]; clarification?:ClarificationState; reviewReadiness?:ReviewReadiness; }

/** Caller-owned evidence contract. No model output can mark a browser check complete. */
export function validateReviewScope(value:unknown):ReviewScope|undefined{
  if(value===undefined)return undefined;
  if(!isRecord(value)||value.stage!=='specification'||Object.keys(value).some(k=>!['stage','pendingChecks','issues'].includes(k))||!Array.isArray(value.pendingChecks)||value.pendingChecks.length>20)throw new Error('Invalid review scope');
  const ids=new Set<string>();
  const pendingChecks=value.pendingChecks.map(check=>{
    if(!isRecord(check)||Object.keys(check).some(k=>!['id','requirement','evidenceRequired'].includes(k)))throw new Error('Invalid pending check');
    for(const key of ['id','requirement','evidenceRequired'])if(typeof check[key]!=='string'||!check[key].trim()||check[key].length>(key==='id'?80:2000))throw new Error('Invalid pending check text');
    const id=check.id as string;
    if(!/^[a-zA-Z0-9_-]+$/.test(id)||ids.has(id))throw new Error('Invalid or duplicate pending check id');
    ids.add(id);return {id,requirement:check.requirement as string,evidenceRequired:check.evidenceRequired as string};
  });
  const issues:ReviewIssue[]=[];
  if(value.issues!==undefined){
    if(!Array.isArray(value.issues)||value.issues.length>50)throw new Error('Invalid review issues');
    const issueIds=new Set<string>(),texts=new Set<string>();
    for(const issue of value.issues){
      if(!isRecord(issue)||Object.keys(issue).some(k=>!['id','text'].includes(k))||typeof issue.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(issue.id)||typeof issue.text!=='string'||!issue.text.trim()||issue.text.length>2000||issue.text!==issue.text.trim()||issueIds.has(issue.id)||texts.has(issue.text))throw new Error('Invalid or duplicate review issue');
      issueIds.add(issue.id);texts.add(issue.text);issues.push({id:issue.id,text:issue.text});
    }
  }
  return {stage:'specification',pendingChecks,...(value.issues!==undefined?{issues}:{})};
}
/** Notes add context to a known concern; they cannot redefine, resolve or create one. */
export function validateIssueNotes(value:unknown,scope:ReviewScope|undefined):IssueNote[]{
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>100)throw new Error('Invalid issue notes');
  const seen=new Set<string>(),notes:IssueNote[]=[];
  for(const raw of value){
    if(!isRecord(raw)||Object.keys(raw).some(k=>!['issueId','note'].includes(k))||typeof raw.issueId!=='string'||!scope?.issues?.some(i=>i.id===raw.issueId)||typeof raw.note!=='string'||!raw.note.trim()||raw.note.length>2000)throw new Error('Invalid issue note or unknown issue ID');
    const note={issueId:raw.issueId,note:raw.note},key=canonicalize(note);
    if(!seen.has(key)){seen.add(key);notes.push(note);}
  }
  return notes;
}
function mergeIssueNotes(groups:IssueNote[][],scope:ReviewScope|undefined):IssueNote[]{
  const notes=new Map<string,IssueNote>();
  for(const group of groups)for(const note of validateIssueNotes(group,scope))notes.set(canonicalize(note),note);
  // Apply the total bound after deduplication; repeated notes never consume new slots.
  return validateIssueNotes([...notes.values()],scope);
}
export function candidateFromProposal(proposal:Candidate):Candidate{
  const reviewScope=validateReviewScope(proposal.reviewScope);
  return deepClone({baseVersion:proposal.baseVersion,changes:proposal.changes,...(reviewScope?{reviewScope}:{})});
}
export function bindReviewScope(proposal:DesignProposal,context:Readonly<DesignContext>):DesignProposal{
  const reviewScope=validateReviewScope(context.reviewScope),supplied=validateReviewScope(proposal.reviewScope);
  if(supplied&&canonicalize(supplied)!==canonicalize(reviewScope??null))throw new Error('Proposal review scope differs from the caller contract');
  const issueNotes=validateIssueNotes(proposal.issueNotes,reviewScope);
  if(!Array.isArray(proposal.unresolved)||proposal.unresolved.some(i=>typeof i!=='string'||!i.trim()))throw new Error('Invalid unresolved issues');
  const unresolved=[...new Set([...(reviewScope?.issues??[]).map(i=>i.text),...proposal.unresolved])];
  return {...deepClone(proposal),unresolved,...(proposal.issueNotes!==undefined?{issueNotes}:{}),...(reviewScope?{reviewScope}:{})};
}
export function reviewReadiness(candidate:Candidate,candidateHash:string,critiques:Critique[]=[]):ReviewReadiness{
  const scope=validateReviewScope(candidate.reviewScope);
  const deferredIssues:DeferredIssueEvidence[]=critiques.filter(c=>c.candidateHash===candidateHash).flatMap(c=>(c.deferredIssues??[]).map(d=>({...deepClone(d),...(scope?.issues?.find(i=>i.text===d.issue)?{issueId:scope.issues.find(i=>i.text===d.issue)!.id}:{}),reviewer:c.reviewer,proposalId:c.proposalId,candidateHash,status:'open' as const,evidenceKind:'unverified' as const})));
  return {stage:scope?.stage??'unspecified',candidateHash,renderedVerified:false,pendingChecks:(scope?.pendingChecks??[]).map(check=>({...check,status:'pending'})),deferredIssues};
}

/** Validate a review disposition, never infer that a concern is safe to defer. */
export function validateDeferredIssues(value:unknown,proposal:Readonly<DesignProposal>,resolvedIssues:readonly string[]=[],issueObjections:readonly {issue:string;reason:string}[]=[]):DeferredIssue[]{
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>proposal.unresolved.length)throw new Error('Invalid deferred issues');
  const scope=validateReviewScope(proposal.reviewScope),seen=new Set<string>();
  return value.map(raw=>{
    if(!isRecord(raw)||Object.keys(raw).some(k=>!['issue','issueId','checkId','reason'].includes(k)))throw new Error('Invalid deferred issue');
    if(typeof raw.issue!=='string'||!proposal.unresolved.includes(raw.issue)||seen.has(raw.issue))throw new Error('Unknown or duplicate deferred issue');
    if(typeof raw.checkId!=='string'||!scope?.pendingChecks.some(c=>c.id===raw.checkId))throw new Error('Deferred issue requires a caller-defined pending check');
    if(typeof raw.reason!=='string'||!raw.reason.trim()||raw.reason.length>1000)throw new Error('Invalid deferred issue reason');
    if(resolvedIssues.includes(raw.issue)||issueObjections.some(o=>o.issue===raw.issue))throw new Error('Contradictory deferred issue disposition');
    const known=scope?.issues?.find(i=>i.text===raw.issue);
    if(raw.issueId!==undefined&&raw.issueId!==known?.id)throw new Error('Deferred issue identity does not match the caller issue');
    seen.add(raw.issue);return {issue:raw.issue,...(known?{issueId:known.id}:{}),checkId:raw.checkId,reason:raw.reason};
  });
}

function deferralsAgree(a:Critique,b:Critique):boolean{
  const mapping=(c:Critique)=>[...(c.deferredIssues??[])].map(d=>({issue:d.issue,checkId:d.checkId})).sort((x,y)=>x.issue.localeCompare(y.issue));
  return canonicalize(mapping(a))===canonicalize(mapping(b));
}

/** Ground a reviewer's claim in supplied text; this does not prove the claimed contradiction. */
export function validateClarificationRequests(value:unknown,context:Readonly<DesignContext>):ClarificationRequest[]{
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>4)throw new Error('Invalid clarification requests');
  const text=(v:unknown,max:number):string=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error('Invalid clarification text');return v;};
  return value.map(raw=>{
    if(!isRecord(raw)||!Array.isArray(raw.requirements)||raw.requirements.length<2||raw.requirements.length>4)throw new Error('Clarification requires two to four quoted requirements');
    const reason=text(raw.reason,1000),question=text(raw.question,500),quotes=new Set<string>();
    const requirements=raw.requirements.map(item=>{
      if(!isRecord(item)||typeof item.source!=='string'||!['brief','criteria','validation'].includes(item.source))throw new Error('Invalid clarification source');
      const source=item.source as 'brief'|'criteria'|'validation',quote=text(item.quote,1000);
      const sources=source==='brief'?[context.brief]:source==='criteria'?context.criteria:context.deterministicFeedback?.errors??[];
      if(!sources.some(s=>s.includes(quote))||quotes.has(quote))throw new Error('Clarification quotes must be distinct and present in the supplied source');
      quotes.add(quote);return {source,quote};
    });
    return {reason,question,requirements};
  });
}

export async function clarificationForReview(critique:Critique,proposal:DesignProposal,reviewer:string,context:Readonly<DesignContext>):Promise<ClarificationEvidence[]>{
  // Callers outside the consensus engine receive the same identity/hash checks.
  await reviewIsComplete(critique,proposal,reviewer);
  return validateClarificationRequests(critique.clarificationRequests,context).map(request=>({reviewer,proposalId:proposal.id,candidateHash:critique.candidateHash,reviewedCandidate:candidateFromProposal(proposal),request,evidenceKind:'unverified'}));
}

export async function sha256(value: unknown): Promise<string> {
  const bytes=new TextEncoder().encode(canonicalize(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export function mergeProposals(a: DesignProposal,b: DesignProposal): { candidate: Candidate; conflicts: Conflict[] } {
  if(canonicalize(validateReviewScope(a.reviewScope)??null)!==canonicalize(validateReviewScope(b.reviewScope)??null))throw new Error('Cannot merge different review scopes');
  const byPath=new Map<string,Change>(); const conflicts:Conflict[]=[];
  for (const change of a.changes){
    const prior=byPath.get(change.path);
    if(prior)conflicts.push({path:change.path,astra:[deepClone(prior.value),deepClone(change.value)],fable:null});
    else byPath.set(change.path,deepClone(change));
  }
  const seenFable=new Map<string,Change>();
  for (const change of b.changes) {
    const priorFable=seenFable.get(change.path);
    if(priorFable)conflicts.push({path:change.path,astra:null,fable:[deepClone(priorFable.value),deepClone(change.value)]});
    else seenFable.set(change.path,change);
    for(const counterpart of a.changes){
      if(change.path===counterpart.path)continue;
      if(change.path.startsWith(`${counterpart.path}.`)||counterpart.path.startsWith(`${change.path}.`)){
        const parent=change.path.length<counterpart.path.length?change.path:counterpart.path;
        conflicts.push({path:parent,astra:{path:counterpart.path,value:deepClone(counterpart.value)},fable:{path:change.path,value:deepClone(change.value)}});
      }
    }
    const existing=byPath.get(change.path);
    if (!existing) byPath.set(change.path,deepClone(change));
    else if (canonicalize(existing.value)!==canonicalize(change.value)) conflicts.push({path:change.path,astra:deepClone(existing.value),fable:deepClone(change.value)});
  }
  return {candidate:candidateFromProposal({...a,changes:[...byPath.values()].sort((x,y)=>x.path.localeCompare(y.path))}),conflicts};
}

export function assertCallerIssuesPresent(proposal:Readonly<DesignProposal>):void{
  if(validateReviewScope(proposal.reviewScope)?.issues?.some(issue=>!proposal.unresolved.includes(issue.text)))throw new Error('Reviewed proposal omitted a caller issue');
}
export async function reviewIsComplete(critique:Critique,proposal:DesignProposal,reviewer:string):Promise<boolean>{
  assertCallerIssuesPresent(proposal);
  if(critique.reviewer!==reviewer||critique.proposalId!==proposal.id)throw new Error('Review identity does not match the requested reviewer and proposal');
  if(critique.candidateHash!==await sha256(candidateFromProposal(proposal)))throw new Error('Review hash does not match the exact candidate');
  if(critique.clarificationRequests!==undefined&&!Array.isArray(critique.clarificationRequests))throw new Error('Invalid clarification requests');
  const deferred=validateDeferredIssues(critique.deferredIssues,proposal,critique.resolvedIssues,critique.issueObjections);
  return !critique.clarificationRequests?.length&&!critique.issueObjections?.length&&proposal.unresolved.every(issue=>critique.resolvedIssues?.includes(issue)||deferred.some(d=>d.issue===issue))&&!critique.objections.some(o=>o.severity==='blocking')&&proposal.changes.every(change=>
    critique.acceptedPaths.includes(change.path)||critique.objections.some(o=>o.path===change.path&&o.severity==='warning'));
}

export async function runConsensus(opts:{astra:DesignAgent;fable:DesignAgent;context:DesignContext;maxRounds?:number;evaluate?:(candidate:Candidate)=>Promise<string[]>|string[]}):Promise<ConsensusRun>{
  const max=opts.maxRounds??5;
  if(!Number.isInteger(max)||max<1||max>10)throw new Error('Consensus rounds must be an integer from 1 to 10');
  if(opts.astra.id===opts.fable.id)throw new Error('Consensus requires distinct reviewer identities');
  validateReviewScope(opts.context.reviewScope);
  const context=deepFreeze(deepClone(opts.context));
  const [rawA,rawB]=await Promise.all([opts.astra.generateProposal(context),opts.fable.generateProposal(context)]);
  const initialA=bindReviewScope(rawA,context),initialB=bindReviewScope(rawB,context);
  let a=deepClone(initialA), b=deepClone(initialB); const critiques:Critique[]=[];
  const recordedIssues=new Set([...a.unresolved,...b.unresolved]);
  let issueNotes:IssueNote[]=[];
  const evaluate=async(candidate:Candidate):Promise<string[]>=>[
    ...(candidate.baseVersion===context.baseVersion?[]:['Candidate base version does not match the context']),
    ...(opts.evaluate?await opts.evaluate(deepFreeze(deepClone(candidate))):[])
  ];
  for(let round=1;round<=max;round++){
    for(const issue of [...a.unresolved,...b.unresolved])recordedIssues.add(issue);
    issueNotes=mergeIssueNotes([issueNotes,a.issueNotes??[],b.issueNotes??[]],context.reviewScope);
    // Revision omission is not issue resolution. Every later review sees the accumulated concerns.
    a={...a,unresolved:[...recordedIssues]};b={...b,unresolved:[...recordedIssues]};
    const merged=mergeProposals(a,b),hash=await sha256(merged.candidate);
    const errors=await evaluate(merged.candidate);
    if(b.baseVersion!==context.baseVersion)errors.push('Fable proposal base version does not match the context');
    const shared:DesignProposal={id:`CANDIDATE-${hash}`,author:'consensus',...deepClone(merged.candidate),summary:'Combined candidate for exact review',...(issueNotes.length?{issueNotes}:{}),tradeoffs:[...new Set([...a.tradeoffs,...b.tradeoffs])],unresolved:[...new Set([...a.unresolved,...b.unresolved])]};
    // Conflicts retain both alternatives. A conflict-free union is reviewed in full by both roles.
    const targetA=merged.conflicts.length?a:shared,targetB=merged.conflicts.length?b:shared;
    const reviewContext=async(proposal:DesignProposal,counterpart:DesignProposal):Promise<Readonly<DesignContext>>=>{
      const candidate=candidateFromProposal(proposal);
      return deepFreeze(deepClone({...context,deterministicFeedback:{candidateHash:await sha256(candidate),errors:await evaluate(candidate)},
        ...(merged.conflicts.length?{reconciliation:{counterpart:candidateFromProposal(counterpart),conflicts:merged.conflicts}}:{})}));
    };
    const [aContext,bContext]=await Promise.all([reviewContext(targetA,b),reviewContext(targetB,a)]);
    const [critAonB,critBonA]=await Promise.all([
      opts.astra.critiqueProposal(deepFreeze(deepClone(targetB)),bContext),
      opts.fable.critiqueProposal(deepFreeze(deepClone(targetA)),aContext)
    ]);
    const [acceptedB,acceptedA]=await Promise.all([reviewIsComplete(critAonB,targetB,opts.astra.id),reviewIsComplete(critBonA,targetA,opts.fable.id)]);
    const readiness=reviewReadiness(merged.candidate,hash,[critAonB,critBonA]);
    critiques.push(critAonB,critBonA);
    const clarificationRequests=[...await clarificationForReview(critAonB,targetB,opts.astra.id,bContext),...await clarificationForReview(critBonA,targetA,opts.fable.id,aContext)];
    if(clarificationRequests.length){
      return {...(issueNotes.length?{issueNotes:deepClone(issueNotes)}:{}),status:'NEEDS_CLARIFICATION',reviewReadiness:readiness,rounds:round,initial:[deepClone(initialA),deepClone(initialB)],critiques,candidate:merged.candidate,candidateHash:hash,conflicts:merged.conflicts,evaluationErrors:errors,clarification:{contextHash:await sha256(context),requests:clarificationRequests}};
    }
    if(merged.conflicts.length===0&&errors.length===0&&acceptedA&&acceptedB&&deferralsAgree(critAonB,critBonA)){
      return {...(issueNotes.length?{issueNotes:deepClone(issueNotes)}:{}),status:'CONSENSUS',reviewReadiness:readiness,rounds:round,initial:[deepClone(initialA),deepClone(initialB)],critiques,candidate:merged.candidate,candidateHash:hash,conflicts:[],evaluationErrors:[]};
    }
    if(round===max){
      return {...(issueNotes.length?{issueNotes:deepClone(issueNotes)}:{}),status:merged.conflicts.length?'DEADLOCK':errors.length?'INVALID':'PARTIAL_CONSENSUS',reviewReadiness:readiness,rounds:round,initial:[deepClone(initialA),deepClone(initialB)],critiques,candidate:merged.candidate,candidateHash:hash,conflicts:merged.conflicts,evaluationErrors:errors};
    }
    // No revision can be terminal: the next round must review its exact result.
    [a,b]=await Promise.all([
      opts.astra.reviseProposal(deepFreeze(deepClone(targetA)),deepFreeze(deepClone(critBonA)),aContext,round),
      opts.fable.reviseProposal(deepFreeze(deepClone(targetB)),deepFreeze(deepClone(critAonB)),bContext,round)
    ]);
    a=bindReviewScope(a,context);b=bindReviewScope(b,context);
  }
  throw new Error('Unreachable consensus state');
}

export function approve(actor:string,candidateHash:string):Approval{return {actor,candidateHash,accepted:true,remainingObjections:[]};}
export function approvalsMatch(candidateHash:string,approvals:Approval[],requiredActors:string[]=['astra','fable']):boolean{
  return requiredActors.every(actor=>approvals.some(a=>a.actor===actor&&a.accepted&&a.candidateHash===candidateHash&&a.remainingObjections.length===0));
}
export async function approvalsStillValid(candidate:Candidate,approvals:Approval[]):Promise<boolean>{const hash=await sha256(candidate);return approvals.every(a=>a.candidateHash===hash);}
export function canRelease(input:{candidateHash:string;approvals:Approval[];humanApproved:boolean;requireHumanApproval?:boolean}):boolean{
  const requireHuman=input.requireHumanApproval??true;
  return approvalsMatch(input.candidateHash,input.approvals) && (!requireHuman || input.humanApproved);
}
