import { canonicalize, deepClone, deepFreeze } from '../../style-spec/src/index.js';

export interface DesignContext { brief: string; criteria: string[]; baseVersion: string; referenceSpec?: unknown; }
export interface Change { path: string; value: unknown; rationale?: string; }
export interface DesignProposal { id: string; author: string; baseVersion: string; summary: string; changes: Change[]; tradeoffs: string[]; unresolved: string[]; }
export interface Objection { path: string; reason: string; severity: 'warning'|'blocking'; }
export interface Critique { reviewer: string; proposalId: string; objections: Objection[]; acceptedPaths: string[]; }
export interface DesignAgent { id: string; generateProposal(context: Readonly<DesignContext>): Promise<DesignProposal>; critiqueProposal(proposal: Readonly<DesignProposal>, context: Readonly<DesignContext>): Promise<Critique>; reviseProposal(proposal: Readonly<DesignProposal>, critique: Readonly<Critique>, context: Readonly<DesignContext>, round: number): Promise<DesignProposal>; }
export interface Conflict { path: string; astra: unknown; fable: unknown; }
export interface Candidate { baseVersion: string; changes: Change[]; }
export interface Approval { actor: string; candidateHash: string; accepted: true; remainingObjections: string[]; }
export type ConsensusStatus='CONSENSUS'|'PARTIAL_CONSENSUS'|'DEADLOCK'|'INVALID';
export interface ConsensusRun { status: ConsensusStatus; rounds: number; initial: [DesignProposal,DesignProposal]; critiques: Critique[]; candidate: Candidate; candidateHash: string; conflicts: Conflict[]; evaluationErrors: string[]; }

export async function sha256(value: unknown): Promise<string> {
  const bytes=new TextEncoder().encode(canonicalize(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export function mergeProposals(a: DesignProposal,b: DesignProposal): { candidate: Candidate; conflicts: Conflict[] } {
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
  return {candidate:{baseVersion:a.baseVersion,changes:[...byPath.values()].sort((x,y)=>x.path.localeCompare(y.path))},conflicts};
}

function proposalValues(proposal:DesignProposal):string{
  return canonicalize(proposal.changes.map(change=>({path:change.path,value:change.value})).sort((a,b)=>a.path.localeCompare(b.path)));
}

export async function runConsensus(opts:{astra:DesignAgent;fable:DesignAgent;context:DesignContext;maxRounds?:number;evaluate?:(candidate:Candidate)=>Promise<string[]>|string[]}):Promise<ConsensusRun>{
  const max=opts.maxRounds??5; const context=deepFreeze(deepClone(opts.context));
  const [initialA,initialB]=await Promise.all([opts.astra.generateProposal(context),opts.fable.generateProposal(context)]);
  let a=deepClone(initialA), b=deepClone(initialB); const critiques:Critique[]=[]; let lastErrors:string[]=[];
  for(let round=1;round<=max;round++){
    const [critAonB,critBonA]=await Promise.all([
      opts.astra.critiqueProposal(deepFreeze(deepClone(b)),context),
      opts.fable.critiqueProposal(deepFreeze(deepClone(a)),context)
    ]);
    critiques.push(critAonB,critBonA);
    const beforeA=proposalValues(a),beforeB=proposalValues(b);
    [a,b]=await Promise.all([
      opts.astra.reviseProposal(deepFreeze(deepClone(a)),deepFreeze(deepClone(critBonA)),context,round),
      opts.fable.reviseProposal(deepFreeze(deepClone(b)),deepFreeze(deepClone(critAonB)),context,round)
    ]);
    const merged=mergeProposals(a,b);
    lastErrors=opts.evaluate?await opts.evaluate(merged.candidate):[];
    const reviewPending=critAonB.objections.some(o=>o.severity==='blocking')||critBonA.objections.some(o=>o.severity==='blocking')||beforeA!==proposalValues(a)||beforeB!==proposalValues(b);
    if(merged.conflicts.length===0 && lastErrors.length===0 && !reviewPending){
      const hash=await sha256(merged.candidate);
      return {status:'CONSENSUS',rounds:round,initial:[deepClone(initialA),deepClone(initialB)],critiques,candidate:merged.candidate,candidateHash:hash,conflicts:[],evaluationErrors:[]};
    }
    if(round===max){
      const hash=await sha256(merged.candidate);
      return {status:merged.conflicts.length?'DEADLOCK':lastErrors.length?'INVALID':'PARTIAL_CONSENSUS',rounds:round,initial:[deepClone(initialA),deepClone(initialB)],critiques,candidate:merged.candidate,candidateHash:hash,conflicts:merged.conflicts,evaluationErrors:lastErrors};
    }
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
