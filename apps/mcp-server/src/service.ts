import { evaluateSpec } from '../../../packages/evaluator/src/index.js';
import { approve, approvalsMatch, mergeProposals, runConsensus, sha256, type Approval, type Candidate, type DesignAgent, type DesignProposal } from '../../../packages/consensus-engine/src/index.js';
import { deepClone, getPath, isRecord, setPath } from '../../../packages/style-spec/src/index.js';
import { checkStyleCompliance } from '../../../packages/compliance/src/index.js';

export interface SpecBundle { manifest: Record<string,unknown>; principles: unknown; tokens: Record<string,unknown>; components: Record<string,unknown>[]; patterns: unknown[]; antiPatterns: unknown; accessibility: Record<string,unknown>; decisions: Record<string,string>; }
export class StyleService {
 private proposals=new Map<string,DesignProposal>();
 private candidates=new Map<string,{candidate:Candidate;status:'candidate'|'released';approvals:Approval[];source:'manual'|'agent-consensus'}>();
 constructor(private bundle:SpecBundle){}
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
 async startConsensusRound(astraProposalId:string,fableProposalId:string,authToken:string|undefined,expectedToken:string|undefined){this.authorize(authToken,expectedToken);const a=this.proposals.get(astraProposalId),b=this.proposals.get(fableProposalId);if(!a||!b)throw new Error('Unknown proposal');if(a.author!=='astra'||b.author!=='fable')throw new Error('Proposal roles must be astra and fable');const merged=mergeProposals(a,b);if(merged.conflicts.length)return {status:'needs_revision',conflicts:merged.conflicts};const deterministicErrors=this.evaluateCandidate(merged.candidate);if(deterministicErrors.length)return {status:'invalid_candidate',deterministicErrors};const candidateHash=await sha256(merged.candidate);this.candidates.set(candidateHash,{candidate:deepClone(merged.candidate),status:'candidate',approvals:[],source:'manual'});return {status:'candidate_ready',candidateHash,candidate:merged.candidate};}
 async generateCandidateFromBrief(input:{brief:string;criteria:string[];maxRounds?:number;astra:DesignAgent;fable:DesignAgent},authToken:string|undefined,expectedToken:string|undefined){
   this.authorize(authToken,expectedToken);
   const baseVersion=String(this.bundle.manifest.version??'0.0.0');
   const referenceSpec={tokens:this.bundle.tokens,components:Object.fromEntries(this.bundle.components.map(c=>[String(c.id),c])),principles:this.bundle.principles,accessibility:this.bundle.accessibility};
   const run=await runConsensus({astra:input.astra,fable:input.fable,context:{brief:input.brief,criteria:input.criteria,baseVersion,referenceSpec},maxRounds:input.maxRounds??5,evaluate:c=>this.evaluateCandidate(c)});
   for(const proposal of run.initial)this.proposals.set(proposal.id,deepClone(proposal));
   if(run.status==='CONSENSUS')this.candidates.set(run.candidateHash,{candidate:deepClone(run.candidate),status:'candidate',approvals:[],source:'agent-consensus'});
   return run;
 }
 getConsensusStatus(candidateHash:string){const c=this.candidates.get(candidateHash);if(!c)throw new Error('Unknown candidate');return {candidateHash,status:c.status,source:c.source,approvals:c.approvals.map(a=>a.actor)};}
 approveCandidate(candidateHash:string,actor:'astra'|'fable',authToken:string|undefined,expectedToken:string|undefined){this.authorize(authToken,expectedToken);const c=this.candidates.get(candidateHash);if(!c)throw new Error('Unknown candidate');c.approvals=c.approvals.filter(a=>a.actor!==actor);c.approvals.push(approve(actor,candidateHash));return {candidateHash,actor,approved:true};}
 publishRelease(candidateHash:string,humanApproved:boolean,authToken:string|undefined,expectedToken:string|undefined,humanApprovalToken?:string,expectedHumanApprovalToken?:string){this.authorize(authToken,expectedToken);const c=this.candidates.get(candidateHash);if(!c)throw new Error('Unknown candidate');if(!humanApproved)throw new Error('Human approval required');if(!expectedHumanApprovalToken||humanApprovalToken!==expectedHumanApprovalToken)throw new Error('Separate human approval credential required');if(!approvalsMatch(candidateHash,c.approvals))throw new Error('Astra and Fable approvals required');c.status='released';return {candidateHash,status:'released'};}
 compareSpecVersions(fromVersion:string,toVersion:string){const current=String(this.bundle.manifest.version??'');if(fromVersion===current&&toVersion===current)return {fromVersion,toVersion,changes:[]};return {fromVersion,toVersion,availableVersions:[current],message:'Only the current canonical version is bundled in v0.1.0; historical manifests can be added under releases/.'};}
 private evaluateCandidate(candidate:Candidate):string[]{
   if(candidate.baseVersion!==String(this.bundle.manifest.version??''))return [`Candidate baseVersion ${candidate.baseVersion} does not match canonical version ${String(this.bundle.manifest.version??'')}`];
   const draft={tokens:deepClone(this.bundle.tokens),components:Object.fromEntries(this.bundle.components.map(c=>[String(c.id),deepClone(c)]))};const errors:string[]=[];
   for(const change of candidate.changes){
     if(!(change.path.startsWith('tokens.')||change.path.startsWith('components.'))){errors.push(`Unsupported change path: ${change.path}`);continue;}
     if(change.path.startsWith('tokens.')&&!change.path.endsWith('.$value')){errors.push(`Token changes must target an existing .$value: ${change.path}`);continue;}
     try{setPath(draft as unknown as Record<string,unknown>,change.path,change.value);}catch(error){errors.push(error instanceof Error?error.message:String(error));}
   }
   if(errors.length)return errors;
   const components=isRecord(draft.components)?Object.values(draft.components).filter(isRecord):[];
   const result=evaluateSpec({manifest:this.bundle.manifest,tokens:draft.tokens,components,accessibility:this.bundle.accessibility as {contrastPairs?:any[]}});
   return result.issues.filter(i=>i.severity==='error').map(i=>`${i.code} ${i.path}: ${i.message}`);
 }
 private authorize(got:string|undefined,expected:string|undefined){if(!expected||got!==expected)throw new Error('Unauthorized');}
}
