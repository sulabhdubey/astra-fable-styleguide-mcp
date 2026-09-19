import { evaluateSpec } from '../../../packages/evaluator/src/index.js';
import { approve, approvalsMatch, mergeProposals, runConsensus, sha256, type Approval, type Candidate, type DesignAgent, type DesignProposal } from '../../../packages/consensus-engine/src/index.js';
import { addPath, deepClone, getPath, isRecord, setPath, tokenReference } from '../../../packages/style-spec/src/index.js';
import { checkStyleCompliance } from '../../../packages/compliance/src/index.js';
import { compareSnapshots, type StyleSnapshot } from '../../../packages/versioning/src/index.js';

export interface SpecBundle { manifest: Record<string,unknown>; principles: unknown; tokens: Record<string,unknown>; components: Record<string,unknown>[]; patterns: unknown[]; antiPatterns: unknown; accessibility: Record<string,unknown>; decisions: Record<string,string>; }
interface GovernanceRunSummary { runId:string; source:'manual'|'agent-consensus'; status:string; rounds:number; proposalIds:string[]; conflictPaths:string[]; conflictCount?:number; evaluationErrorCount:number; candidateHash?:string; }
export class StyleService {
 private proposals=new Map<string,DesignProposal>();
 private candidates=new Map<string,{candidate:Candidate;status:'candidate'|'released';approvals:Approval[];source:'manual'|'agent-consensus'}>();
 private recentRuns:GovernanceRunSummary[]=[];
 constructor(private bundle:SpecBundle, private snapshots:ReadonlyMap<string,StyleSnapshot>=new Map()){}
 getManifest(){return this.bundle.manifest;}
 getDesignTokens(scope?:string){ if(!scope)return this.bundle.tokens; const v=getPath(this.bundle.tokens,scope); if(v===undefined)throw new Error(`Unknown token scope: ${scope}`); return v; }
 getComponentRules(component:string){const found=this.bundle.components.find(c=>c.id===component);if(!found)throw new Error(`Unknown component: ${component}`);return found;}
 search(query:string){const q=query.toLowerCase();const hits:{kind:string;id:string;value:unknown}[]=[];for(const c of this.bundle.components)if(JSON.stringify(c).toLowerCase().includes(q))hits.push({kind:'component',id:String(c.id),value:c});for(const [k,v] of Object.entries(this.bundle.decisions))if((k+v).toLowerCase().includes(q))hits.push({kind:'decision',id:k,value:v});return hits.slice(0,25);}
 explainDecision(id:string){const v=this.bundle.decisions[id];if(!v)throw new Error(`Unknown decision: ${id}`);return {id,text:v};}
 validate(){return evaluateSpec({manifest:this.bundle.manifest,tokens:this.bundle.tokens,components:this.bundle.components,accessibility:this.bundle.accessibility as {contrastPairs?:any[]}});}
 checkStyleCompliance(input:string){return checkStyleCompliance(input,this.bundle.tokens);}
 createProposal(id:string,payload:DesignProposal,authToken:string|undefined,expectedToken:string|undefined){this.authorize(authToken,expectedToken);if(this.proposals.has(id))throw new Error('Proposal already exists');if(payload.id!==id)throw new Error('Proposal id mismatch');this.proposals.set(id,deepClone(payload));return {id,status:'open'};}
 getProposal(id:string){const p=this.proposals.get(id);return p?deepClone(p):undefined;}
 evaluateProposal(id:string,authToken:string|undefined,expectedToken:string|undefined){this.authorize(authToken,expectedToken);const proposal=this.proposals.get(id);if(!proposal)throw new Error('Unknown proposal');const paths=new Set<string>();const duplicatePaths=proposal.changes.filter(c=>paths.has(c.path)||!paths.add(c.path));const candidate={baseVersion:proposal.baseVersion,changes:proposal.changes};const deterministicErrors=this.evaluateCandidate(candidate);return {id,valid:proposal.changes.length>0&&duplicatePaths.length===0&&deterministicErrors.length===0,duplicatePaths:duplicatePaths.map(c=>c.path),deterministicErrors,baseline:this.validate()};}
 async startConsensusRound(astraProposalId:string,fableProposalId:string,authToken:string|undefined,expectedToken:string|undefined){
   this.authorize(authToken,expectedToken);
   const a=this.proposals.get(astraProposalId),b=this.proposals.get(fableProposalId);
   if(!a||!b)throw new Error('Unknown proposal');
   if(a.author!=='astra'||b.author!=='fable')throw new Error('Proposal roles must be astra and fable');
   const runId=crypto.randomUUID(),proposalIds=[astraProposalId,fableProposalId];
   const merged=mergeProposals(a,b);
   if(merged.conflicts.length){this.recordRun({runId,source:'manual',status:'needs_revision',rounds:1,proposalIds,conflictPaths:merged.conflicts.map(c=>c.path),evaluationErrorCount:0});return {status:'needs_revision',runId,conflicts:merged.conflicts};}
   const deterministicErrors=this.evaluateCandidate(merged.candidate);
   if(deterministicErrors.length){this.recordRun({runId,source:'manual',status:'invalid_candidate',rounds:1,proposalIds,conflictPaths:[],evaluationErrorCount:deterministicErrors.length});return {status:'invalid_candidate',runId,deterministicErrors};}
   const candidateHash=await sha256(merged.candidate);
   this.candidates.set(candidateHash,{candidate:deepClone(merged.candidate),status:'candidate',approvals:[],source:'manual'});
   this.recordRun({runId,source:'manual',status:'candidate_ready',rounds:1,proposalIds,conflictPaths:[],evaluationErrorCount:0,candidateHash});
   return {status:'candidate_ready',runId,candidateHash,candidate:merged.candidate};
 }
 async generateCandidateFromBrief(input:{brief:string;criteria:string[];maxRounds?:number;astra:DesignAgent;fable:DesignAgent},authToken:string|undefined,expectedToken:string|undefined){
   this.authorize(authToken,expectedToken);
   const baseVersion=String(this.bundle.manifest.version??'0.0.0');
   const referenceSpec={tokens:this.bundle.tokens,components:Object.fromEntries(this.bundle.components.map(c=>[String(c.id),c])),principles:this.bundle.principles,accessibility:this.bundle.accessibility};
   const runId=crypto.randomUUID();
   let run;
   try {run=await runConsensus({astra:input.astra,fable:input.fable,context:{brief:input.brief,criteria:input.criteria,baseVersion,referenceSpec},maxRounds:input.maxRounds??5,evaluate:c=>this.evaluateCandidate(c)});}
   catch(error){this.recordRun({runId,source:'agent-consensus',status:'provider_error',rounds:0,proposalIds:[],conflictPaths:[],evaluationErrorCount:0});throw error;}
   for(const proposal of run.initial)this.proposals.set(proposal.id,deepClone(proposal));
   if(run.status==='CONSENSUS')this.candidates.set(run.candidateHash,{candidate:deepClone(run.candidate),status:'candidate',approvals:[],source:'agent-consensus'});
   this.recordRun({runId,source:'agent-consensus',status:run.status,rounds:run.rounds,proposalIds:run.initial.map(p=>p.id),conflictPaths:run.conflicts.map(c=>c.path),evaluationErrorCount:run.evaluationErrors.length,...(run.status==='CONSENSUS'?{candidateHash:run.candidateHash}:{})});
   return {...run,runId};
 }
 getConsensusStatus(candidateHash:string,authToken:string|undefined,expectedToken:string|undefined){this.authorize(authToken,expectedToken);const c=this.candidates.get(candidateHash);if(!c)throw new Error('Unknown candidate');return {candidateHash,status:c.status,source:c.source,approvals:c.approvals.map(a=>a.actor),roleApprovalsComplete:approvalsMatch(candidateHash,c.approvals),humanApprovalRequired:c.status!=='released',durable:false,identityAssurance:'shared-admin-credential' as const,baseVersion:c.candidate.baseVersion,changeCount:c.candidate.changes.length,changePaths:c.candidate.changes.slice(0,50).map(change=>change.path)};}
 getGovernanceActivity(authToken:string|undefined,expectedToken:string|undefined){
   this.authorize(authToken,expectedToken);
   return {durable:false,identityAssurance:'shared-admin-credential' as const,retention:'current-process-only' as const,proposals:[...this.proposals.values()].slice(-50).reverse().map(p=>({id:p.id,author:p.author,baseVersion:p.baseVersion,changeCount:p.changes.length,changePaths:p.changes.slice(0,50).map(c=>c.path)})),recentRuns:this.recentRuns.map(r=>({...r,proposalIds:r.proposalIds.slice(0,50),conflictPaths:r.conflictPaths.slice(0,50)})),candidates:[...this.candidates.entries()].slice(-50).reverse().map(([hash])=>this.getConsensusStatus(hash,authToken,expectedToken))};
 }
 approveCandidate(candidateHash:string,actor:'astra'|'fable',authToken:string|undefined,expectedToken:string|undefined){this.authorize(authToken,expectedToken);const c=this.candidates.get(candidateHash);if(!c)throw new Error('Unknown candidate');c.approvals=c.approvals.filter(a=>a.actor!==actor);c.approvals.push(approve(actor,candidateHash));return {candidateHash,actor,approved:true};}
 publishRelease(candidateHash:string,humanApproved:boolean,authToken:string|undefined,expectedToken:string|undefined,humanApprovalToken?:string,expectedHumanApprovalToken?:string){this.authorize(authToken,expectedToken);const c=this.candidates.get(candidateHash);if(!c)throw new Error('Unknown candidate');if(!humanApproved)throw new Error('Human approval required');if(!expectedHumanApprovalToken||humanApprovalToken!==expectedHumanApprovalToken)throw new Error('Separate human approval credential required');if(!approvalsMatch(candidateHash,c.approvals))throw new Error('Astra and Fable approvals required');c.status='released';return {candidateHash,status:'released'};}
 compareSpecVersions(fromVersion:string,toVersion:string){
   const from=this.snapshots.get(fromVersion),to=this.snapshots.get(toVersion);
   if(from&&to)return compareSnapshots(from,to);
   return {fromVersion,toVersion,availableVersions:[...this.snapshots.keys()].sort(),currentCanonicalVersion:String(this.bundle.manifest.version??''),message:'One or both requested immutable StyleSpec snapshots are unavailable.'};
 }
 private evaluateCandidate(candidate:Candidate):string[]{
   if(candidate.baseVersion!==String(this.bundle.manifest.version??''))return [`Candidate baseVersion ${candidate.baseVersion} does not match canonical version ${String(this.bundle.manifest.version??'')}`];
   const draft={tokens:deepClone(this.bundle.tokens),components:Object.fromEntries(this.bundle.components.map(c=>[String(c.id),deepClone(c)]))};const errors:string[]=[];
   for(const change of candidate.changes){
     if(!(change.path.startsWith('tokens.')||change.path.startsWith('components.'))){errors.push(`Unsupported change path: ${change.path}`);continue;}
     const existing=getPath(draft,change.path);
     if(change.path.startsWith('tokens.')){
       if(change.path.endsWith('.$value')){if(existing===undefined){errors.push(`Unknown token value path: ${change.path}`);continue;}}
       else if(existing!==undefined||!isRecord(change.value)||typeof change.value.$type!=='string'||!('$value' in change.value)){errors.push(`New token path requires a complete unused leaf: ${change.path}`);continue;}
     }else if(existing===undefined&&(!/^components\.[^.]+\.tokens\.[^.]+$/.test(change.path)||tokenReference(change.value)===null)){
       errors.push(`New component token mapping requires a token reference: ${change.path}`);continue;
     }
     try{if(existing===undefined)addPath(draft as unknown as Record<string,unknown>,change.path,change.value);else setPath(draft as unknown as Record<string,unknown>,change.path,change.value);}catch(error){errors.push(error instanceof Error?error.message:String(error));}
   }
   if(errors.length)return errors;
   const components=isRecord(draft.components)?Object.values(draft.components).filter(isRecord):[];
   const result=evaluateSpec({manifest:this.bundle.manifest,tokens:draft.tokens,components,accessibility:this.bundle.accessibility as {contrastPairs?:any[]}});
   return result.issues.filter(i=>i.severity==='error').map(i=>`${i.code} ${i.path}: ${i.message}`);
 }
 private authorize(got:string|undefined,expected:string|undefined){if(!expected||got!==expected)throw new Error('Unauthorized');}
 private recordRun(summary:GovernanceRunSummary){this.recentRuns.unshift({...summary,proposalIds:summary.proposalIds.slice(0,50),conflictCount:summary.conflictPaths.length,conflictPaths:summary.conflictPaths.slice(0,50)});if(this.recentRuns.length>50)this.recentRuns.length=50;}
}
