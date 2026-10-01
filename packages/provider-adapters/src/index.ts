import type { Critique, DesignAgent, DesignContext, DesignProposal, ProposalContract } from '../../consensus-engine/src/index.js';
import { sha256, assertCallerIssuesPresent, validateIssueNotes, validateClarificationRequests, validateDeferredIssues, validateReviewScope, bindReviewScope, candidateFromProposal } from '../../consensus-engine/src/index.js';
import { deepClone, deepFreeze, flattenTokenLeaves, getPath, isRecord } from '../../style-spec/src/index.js';

export interface ProviderConfig { provider: string; model: string; }
export type AgentTask='proposal'|'critique'|'revision';
export type AgentInvoker = (request:{role:string;model:string;task:AgentTask;payload:unknown})=>Promise<unknown>;

export interface GovernedHostRequest {
  callId:string;
  role:string;
  model:string;
  task:AgentTask;
  prompt:string;
  format:Record<string,unknown>;
}

/** The caller supplies an authorized, metered, read-only host transport. No retries. */
export function createGovernedHostInvoker(config:{dispatch:(request:Readonly<GovernedHostRequest>)=>Promise<unknown>;maxCalls?:number;maxResponseChars?:number}):AgentInvoker{
  const maxCalls=config.maxCalls??8,maxResponseChars=config.maxResponseChars??12000;
  if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>100)throw new Error('Invalid host call budget');
  if(!Number.isInteger(maxResponseChars)||maxResponseChars<100||maxResponseChars>1000000)throw new Error('Invalid host response character limit');
  if(typeof config.dispatch!=='function')throw new Error('A governed host dispatch function is required');
  let queue:Promise<unknown>=Promise.resolve(),failed=false,calls=0;
  const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
  return request=>{
    // Snapshot before queueing: simultaneous independent proposals cannot mutate each other.
    const snapshot=deepClone(request);
    const operation=queue.then(async()=>{
      if(failed)throw new Error('Governed host stopped after a failed receipt');
      if(calls>=maxCalls)throw new Error('Governed host call budget exhausted');
      try{
        const format=ollamaFormat(snapshot);
        const outgoing=deepFreeze({callId:crypto.randomUUID(),role:snapshot.role,model:snapshot.model,task:snapshot.task,prompt:`${ollamaPrompt(snapshot)}\nRESPONSE_SCHEMA: ${JSON.stringify(format)}`,format});
        calls++;
        const receipt=await config.dispatch(outgoing);
        if(!isRecord(receipt)||receipt.status!=='completed'||receipt.call_id!==outgoing.callId||receipt.host_configured_model!==snapshot.model)throw new Error('Invalid governed host receipt identity or status');
        const usage=receipt.usage,budget=receipt.budget,activity=receipt.activity;
        if(!isRecord(usage)||!integer(usage.input_tokens)||!integer(usage.cached_tokens)||!integer(usage.output_tokens)||usage.cached_tokens>usage.input_tokens)throw new Error('Invalid governed host usage');
        if(typeof receipt.estimated_credits!=='number'||!Number.isFinite(receipt.estimated_credits)||receipt.estimated_credits<0||receipt.cost_basis!=='token_rate_estimate'||!isRecord(budget)||budget.over_budget!==false||budget.reserved_credits!==0)throw new Error('Unsettled governed host budget');
        if(!isRecord(activity)||!isRecord(activity.completed_items)||!integer(activity.completed_items.agentMessage)||activity.completed_items.agentMessage<1||!Object.entries(activity.completed_items).every(([kind,count])=>integer(count)&&(count===0||['agentMessage','reasoning','userMessage'].includes(kind))))throw new Error('Unexpected governed host activity');
        if(typeof receipt.answer!=='string')throw new Error('Missing governed host answer');
        if(receipt.answer.length>maxResponseChars)throw new Error('Host response character limit exceeded');
        // JSON parser errors may quote model text; keep failures free of raw response data.
        let parsed:unknown;
        try{parsed=parseProviderJson(receipt.answer);}catch{throw new Error('Invalid governed host JSON response');}
        assertReviewHasNoControlMarkers(parsed);
        if(snapshot.task==='critique'){
          const reviewed=parseOllamaCritique(parsed,ollamaCritiquePaths(snapshot.payload),ollamaCritiqueIssues(snapshot.payload),ollamaReviewValues(snapshot.payload),ollamaPendingCheckIds(snapshot.payload),ollamaIssueKeys(snapshot.payload));
          if(!isRecord(snapshot.payload)||!isRecord(snapshot.payload.context))throw new Error('Missing review context');
          if(!isRecord(snapshot.payload.proposal))throw new Error('Missing review proposal');
          return normalizeCritique(reviewed,snapshot.role,snapshot.payload.proposal as unknown as DesignProposal,snapshot.payload.context as unknown as DesignContext);
        }
        const context=snapshot.task==='proposal'?snapshot.payload:isRecord(snapshot.payload)?snapshot.payload.context:undefined;
        if(!isRecord(context))throw new Error('Missing governed host proposal context');
        // Validate inside the serialized boundary, before the next reservation can start.
        return normalizeProposal(parsed,snapshot.role,context as unknown as DesignContext);
      }catch(error){failed=true;throw error;}
    });
    queue=operation.catch(()=>undefined);
    return operation;
  };
}

function assertString(value:unknown,label:string):string{if(typeof value!=='string'||!value.trim())throw new Error(`Provider returned invalid ${label}`);return value;}
function assertStringArray(value:unknown,label:string):string[]{if(!Array.isArray(value)||value.some(v=>typeof v!=='string'))throw new Error(`Provider returned invalid ${label}`);return value as string[];}
function assertReviewHasNoControlMarkers(value:unknown):void{
  // Reject observed conversation leakage rather than silently rewriting model evidence.
  if(/<\/?tool_call>|<\|(?:im_start|im_end|eot_id|start_header_id|end_header_id)\|>|\[\/?INST\]/i.test(JSON.stringify(value)??''))throw new Error('Provider review contains a conversation control marker');
}
function permittedNewPath(referenceSpec:unknown,path:string,value:unknown):boolean{
  if(path.split('.').some(segment=>['__proto__','prototype','constructor'].includes(segment)))return false;
  const token=/^tokens(?:\.[A-Za-z][A-Za-z0-9_-]*){2,}$/.exec(path);
  if(token){
    const parent=path.slice(0,path.lastIndexOf('.'));
    const parentValue=getPath(referenceSpec,parent);
    return isRecord(parentValue)&&!('$value' in parentValue)&&isRecord(value)&&typeof value.$type==='string'&&value.$type.trim().length>0&&'$value' in value;
  }
  const mapping=/^components\.([A-Za-z0-9_-]+)\.tokens\.([A-Za-z0-9_-]+)$/.exec(path);
  return Boolean(mapping&&isRecord(getPath(referenceSpec,`components.${mapping[1]}.tokens`))&&typeof value==='string'&&/^\{[A-Za-z0-9_.-]+\}$/.test(value));
}
function checkedProposalContract(contract:ProposalContract|undefined):ProposalContract|undefined{
  if(contract===undefined)return undefined;
  const allowed=contract.allowedPaths;
  if(!Array.isArray(allowed)||allowed.length===0||allowed.length>50||allowed.some(path=>typeof path!=='string'||!path.trim())||new Set(allowed).size!==allowed.length)throw new Error('Invalid proposal contract allowedPaths');
  const required=contract.requiredPaths??[];
  if(!Array.isArray(required)||required.some(path=>typeof path!=='string'||!allowed.includes(path))||new Set(required).size!==required.length)throw new Error('Invalid proposal contract requiredPaths');
  const min=contract.minChanges??Math.max(1,required.length),max=contract.maxChanges??allowed.length;
  if(!Number.isInteger(min)||!Number.isInteger(max)||min<1||max<min||max>allowed.length||required.length>max)throw new Error('Invalid proposal contract change counts');
  return {allowedPaths:[...allowed],requiredPaths:[...required],minChanges:min,maxChanges:max};
}
function normalizeProposal(value:unknown,role:string,context:Readonly<DesignContext>,previousId?:string):DesignProposal{
  const {baseVersion,referenceSpec}=context;
  if(!isRecord(value))throw new Error('Provider proposal must be an object');
  const rawChanges=value.changes;if(!Array.isArray(rawChanges)||rawChanges.length===0)throw new Error('Provider proposal must contain at least one change');
  const changes=rawChanges.map((change,i)=>{if(!isRecord(change))throw new Error(`Invalid change at ${i}`);if(!('value' in change)||change.value===undefined)throw new Error(`Provider returned invalid changes[${i}].value`);return {path:assertString(change.path,`changes[${i}].path`),value:deepClone(change.value),...(typeof change.rationale==='string'?{rationale:change.rationale}:{})};});
  const paths=new Set<string>();
  for(const change of changes){if(paths.has(change.path))throw new Error(`Provider proposal has overlapping change paths: ${change.path}`);paths.add(change.path);}
  for(const path of paths)for(let dot=path.lastIndexOf('.');dot>0;dot=path.lastIndexOf('.',dot-1)){
    const parent=path.slice(0,dot);
    if(paths.has(parent))throw new Error(`Provider proposal has overlapping change paths: ${parent} and ${path}`);
  }
  const contract=checkedProposalContract(context.proposalContract);
  if(contract){
    if(changes.length<(contract.minChanges??1)||changes.length>(contract.maxChanges??contract.allowedPaths.length))throw new Error('Provider proposal violates proposal contract change count');
    for(const change of changes)if(!contract.allowedPaths.includes(change.path))throw new Error(`Provider proposal violates proposal contract path: ${change.path}`);
    for(const required of contract.requiredPaths??[])if(!paths.has(required))throw new Error(`Provider proposal violates proposal contract required path: ${required}`);
  }
  if(referenceSpec!==undefined)for(const change of changes){
    const guidance=/^components\.([A-Za-z0-9_-]+)\.accessibility\.(errorTextRequired|errorAssociation)$/.exec(change.path);
    const existing=getPath(referenceSpec,change.path);
    if(change.path.startsWith('tokens.')&&isRecord(existing))throw new Error(`Change an existing token through its .$value path: ${change.path}`);
    if(change.path.startsWith('tokens.')&&change.path.endsWith('.$value')){
      const leaf=getPath(referenceSpec,change.path.slice(0,-7));
      if(isRecord(leaf)&&leaf.$type==='dimension'&&(typeof change.value!=='string'||!(/^-?(?:\d+|\d*\.\d+)(?:px|rem|em|%)$/.test(change.value)||/^\{[A-Za-z0-9_.-]+\}$/.test(change.value))))throw new Error(`A dimension token needs a dimension string or token reference: ${change.path}`);
      const reference=typeof change.value==='string'?/^\{([A-Za-z0-9_.-]+)\}$/.exec(change.value):null;
      if(reference&&isRecord(leaf)){
        const targetPath=`tokens.${reference[1]}`;
        const added=changes.find(item=>item.path===targetPath)?.value;
        const target=added??getPath(referenceSpec,targetPath);
        if(!isRecord(target)||!('$value' in target)||typeof target.$type!=='string')throw new Error(`Unknown token reference: ${change.value}`);
      }
    }
    if(change.path.startsWith('components.')&&isRecord(existing))throw new Error(`Provider proposed a component object replacement: ${change.path}`);
    if(existing===undefined&&!(guidance&&isRecord(getPath(referenceSpec,`components.${guidance[1]}.accessibility`)))&&!permittedNewPath(referenceSpec,change.path,change.value))throw new Error(`Unknown proposal change path: ${change.path}`);
  }
  const reviewScope=validateReviewScope(value.reviewScope);
  return bindReviewScope({id:previousId??(typeof value.id==='string'&&value.id?value.id:`PROP-${role}-${crypto.randomUUID()}`),author:role,baseVersion,summary:assertString(value.summary,'summary'),changes,tradeoffs:value.tradeoffs===undefined?[]:assertStringArray(value.tradeoffs,'tradeoffs'),unresolved:value.unresolved===undefined?[]:assertStringArray(value.unresolved,'unresolved'),...(value.issueNotes!==undefined?{issueNotes:validateIssueNotes(value.issueNotes,validateReviewScope(context.reviewScope))}:{}),...(reviewScope?{reviewScope}:{})},context);
}
function normalizeCritique(value:unknown,role:string,proposal:DesignProposal,context:Readonly<DesignContext>):Omit<Critique,'candidateHash'>{
  if(!isRecord(value))throw new Error('Provider critique must be an object');
  assertReviewHasNoControlMarkers(value);
  if(value.objections!==undefined&&!Array.isArray(value.objections))throw new Error('Provider returned invalid objections');
  const raw=Array.isArray(value.objections)?value.objections:[];
  const objections=raw.map((o,i)=>{if(!isRecord(o))throw new Error(`Invalid objection at ${i}`);const severity=o.severity==='warning'?'warning':'blocking';return {path:assertString(o.path,`objections[${i}].path`),reason:assertString(o.reason,`objections[${i}].reason`),severity} as const;});
  const acceptedPaths=value.acceptedPaths===undefined?[]:assertStringArray(value.acceptedPaths,'acceptedPaths');
  const resolvedIssues=value.resolvedIssues===undefined?[]:assertStringArray(value.resolvedIssues,'resolvedIssues');
  if(resolvedIssues.some(issue=>!proposal.unresolved.includes(issue)))throw new Error('Resolved issue was not recorded in the reviewed proposal');
  if(value.issueObjections!==undefined&&!Array.isArray(value.issueObjections))throw new Error('Invalid issue objections');
  const issueObjections=(Array.isArray(value.issueObjections)?value.issueObjections:[]).map(item=>{
    if(!isRecord(item))throw new Error('Invalid issue objection');
    const issue=assertString(item.issue,'issue'),reason=assertString(item.reason,'issue reason');
    if(!proposal.unresolved.includes(issue)||resolvedIssues.includes(issue))throw new Error('Unknown or contradictory issue objection');
    return {issue,reason};
  });
  const deferredIssues=validateDeferredIssues(value.deferredIssues,proposal,resolvedIssues,issueObjections);
  const clarificationRequests=validateClarificationRequests(value.clarificationRequests,context),referenceSpec=context.referenceSpec;
  const proposedPaths=new Set(proposal.changes.map(change=>change.path));
  for(const objection of objections)if(!proposedPaths.has(objection.path)&&getPath(referenceSpec,objection.path)===undefined)throw new Error(`Unknown critique path: ${objection.path}`);
  for(const path of acceptedPaths)if(!proposedPaths.has(path))throw new Error(`Accepted path was not proposed: ${path}`);
  for(const objection of objections)if(objection.severity==='blocking'&&acceptedPaths.includes(objection.path))throw new Error(`Contradictory critique for path: ${objection.path}`);
  return {reviewer:role,proposalId:proposal.id,objections:objections.map(o=>({...o,evidenceKind:'unverified'})),acceptedPaths,resolvedIssues,issueObjections,...(deferredIssues.length?{deferredIssues}:{}),...(clarificationRequests.length?{clarificationRequests}:{}),evidenceKind:'unverified'};
}

export class ConfigurableAgent implements DesignAgent {
  constructor(public id:string, private config:ProviderConfig, private invoke:AgentInvoker){}
  async generateProposal(context:Readonly<DesignContext>):Promise<DesignProposal>{validateReviewScope(context.reviewScope);return normalizeProposal(await this.invoke({role:this.id,model:this.config.model,task:'proposal',payload:context}),this.id,context);}
  async critiqueProposal(proposal:Readonly<DesignProposal>,context:Readonly<DesignContext>):Promise<Critique>{assertScopeMatches(proposal,context);const critique=normalizeCritique(await this.invoke({role:this.id,model:this.config.model,task:'critique',payload:{proposal,context}}),this.id,proposal,context);return {...critique,candidateHash:await sha256(candidateFromProposal(proposal))};}
  async reviseProposal(proposal:Readonly<DesignProposal>,critique:Readonly<Critique>,context:Readonly<DesignContext>,round:number):Promise<DesignProposal>{assertScopeMatches(proposal,context);if(critique.candidateHash!==await sha256(candidateFromProposal(proposal)))throw new Error('Stale critique: candidate changed after review');assertReviewHasNoControlMarkers(critique);if(validateClarificationRequests(critique.clarificationRequests,context).length)throw new Error('Clarification required before revision; start a new run with clarified requirements');return normalizeProposal(await this.invoke({role:this.id,model:this.config.model,task:'revision',payload:{proposal,critique,context,round}}),this.id,context,proposal.id);}
}

function assertScopeMatches(proposal:Readonly<DesignProposal>,context:Readonly<DesignContext>):void{
  const bound=bindReviewScope(proposal,context);
  if(JSON.stringify(validateReviewScope(proposal.reviewScope)??null)!==JSON.stringify(bound.reviewScope??null))throw new Error('Review scope does not match the candidate');
  assertCallerIssuesPresent(proposal);
}
function scopeInstructions(payload:unknown,task:AgentTask):string{
  const context=isRecord(payload)&&isRecord(payload.context)?payload.context:payload;
  const scope=validateReviewScope(isRecord(context)?context.reviewScope:undefined);
  if(!scope)return '';
  const identity=scope.issues?.length?'CALLER ISSUE IDENTITIES: '+JSON.stringify(scope.issues)+'. '+(task==='critique'
    ?'HOST-NORMALIZED REVIEW INPUT: The host injects caller concerns into unresolved and combines the independent proposals before review. Their presence is required, not a violation of generation-only instructions to omit them from model output. The merged candidate may contain multiple different notes for one issue ID; these preserve independent explanations and are not duplicates. Only identical ID/note pairs are duplicates, and the host removes those. Do not demand deletion of retained concerns or distinct notes. Review each issue by its stable key and block actual specification defects; defer only when the named pending implementation evidence is the sole missing proof. '
    :'GENERATION OUTPUT RULES: The host always retains these exact concerns. Put explanations for them ONLY in optional issueNotes: [{issueId: <existing caller issue ID>, note: <explanation>}]. Do not repeat or decorate them in unresolved. Use unresolved only for additional distinct concerns. Preserve other recorded concerns verbatim. ')+ 'Notes cannot resolve or waive concerns. ':'';
  return identity+`REVIEW SCOPE: specification only. Evaluate all requested changes, canonical constraints, deterministic feedback, token relationships and preserved behavior from the supplied specification. The caller has separately retained these implementation checks as PENDING: ${JSON.stringify(scope.pendingChecks)}. Their absence alone does not block specification agreement. Never claim they ran, mark them complete, change the scope, or waive their requirements. A detectable specification defect still blocks even when related to a pending check. Keep recorded concerns in unresolved; never silently drop them. If an issue only lacks evidence for one of these declared checks, use the deferred disposition linked to its checkId, with a reason explaining why it is an implementation obligation rather than a specification defect. Deferred issues remain OPEN, not resolved or verified. Use blocking for remaining specification defects, including defects related to a pending check. Resolve an issue only when supplied evidence actually settles it. Conflicting requirements still require clarification. Do not output reviewScope; the host binds it unchanged.\n`;
}

export class OpenAIAdapter extends ConfigurableAgent {constructor(id:string,model:string,invoke:AgentInvoker){super(id,{provider:'openai',model},invoke);}}
export class AnthropicAdapter extends ConfigurableAgent {constructor(id:string,model:string,invoke:AgentInvoker){super(id,{provider:'anthropic',model},invoke);}}
export class OllamaAdapter extends ConfigurableAgent {constructor(id:string,model:string,invoke:AgentInvoker){super(id,{provider:'ollama',model},invoke);}}

function roleFocus(role:string):string{if(role.toLowerCase()==='single')return 'Use both lenses: systems, semantic-token, and maintainability; accessibility, interaction-state, and content-clarity.';return role.toLowerCase()==='fable'?'Use an accessibility, interaction-state, and content-clarity lens.':'Use a systems, semantic-token, and maintainability lens.';}
const clarificationInstructions='Only when requirements cannot be reconciled without a user decision, return optional clarificationRequests: [{"reason":"why they conflict","question":"specific decision needed","requirements":[{"source":"brief|criteria|validation","quote":"exact supplied text"},{"source":"brief|criteria|validation","quote":"distinct exact supplied text"}]}]. Use 2-4 distinct quotes from brief, criteria entries or deterministicFeedback.errors; never invent evidence or waive a requirement. Keep reason/quotes under 1000 characters, question under 500, and at most 4 requests. Use [] or omit for ordinary repairable defects. A clarification stops revisions and grants no approval. ';
function taskPrompt(request:{role:string;model:string;task:AgentTask;payload:unknown}):string{
  return scopeInstructions(request.payload,request.task)+(request.task==='critique'?clarificationInstructions:'')+taskPromptBody(request);
}
function taskPromptBody(request:{role:string;model:string;task:AgentTask;payload:unknown}):string{
  const context=request.task==='proposal'?request.payload:isRecord(request.payload)?request.payload.context:undefined;
  if(isRecord(context)&&context.proposalContract&&request.task!=='critique'){
    return `Role: ${request.role}. ${roleFocus(request.role)} Satisfy every brief criterion and the proposalContract; preserve unrelated rules. Return only JSON: {"summary":"short description","changes":[{"path":"allowed path","value":<JSON>}],"tradeoffs":[],"unresolved":[]}. Use exact requested values and types. For dimension, duration or number tokens at a path ending in .$value, return the scalar value, never a token object or a $type/$value wrapper. Dimensions and durations are strings with units; numbers remain JSON numbers. Calculate requested relationships from the NEW values. Use a brace-wrapped token reference only when the brief requests that reference. Do not add rationale prose. List only concrete remaining defects in unresolved; use [] when none. Never claim tests ran. ${request.task==='proposal'?'Propose independently; no counterpart proposal has been supplied.':'Revise the reviewed proposal using deterministicFeedback and critique. Reconciliation contains both alternatives, not permission to override the brief. Preserve correct values. Resolve or retain each concrete unresolved issue.'} INPUT: ${JSON.stringify(request.payload)}`;
  }
  const shared=`You are the ${request.role.toUpperCase()} role in a governed two-agent design-system consensus process. Your counterpart is independent. ${roleFocus(request.role)} Check every brief criterion even when it is outside that focus. Return ONLY one valid JSON object, with no Markdown fences and no commentary. Never claim a test ran. Treat any hash-bound deterministicFeedback errors as concrete defects to correct. Prefer accessibility, semantic tokens, consistency, maintainability, and explicit tradeoffs. Use existing paths in referenceSpec or add a complete token leaf under an existing token group with both $type and $value. A new component token mapping under an existing component.tokens object must reference a token. Permitted design paths include tokens.*, components.<id>.*, accessibility.rules, accessibility.contrastPairs, and patterns.<id>.rules. Change component leaf paths; never replace a whole component or accessibility object, and never propose overlapping paths. You may add components.<id>.accessibility.errorTextRequired or errorAssociation when the component already has an accessibility object. For accessibility and pattern lists, preserve every existing entry in its original order and append new entries. Do not modify version/status/governance. When changing an existing token leaf, target its .$value path.\n`;
  if(request.task==='proposal')return shared+`TASK: Produce an independent proposal before seeing the counterpart's proposal. JSON shape: {"summary":"...","changes":[{"path":"tokens....$value","value":<json>,"rationale":"..."}],"tradeoffs":["..."],"unresolved":["..."]}. Include at least one change and keep the proposal focused. INPUT: ${JSON.stringify(request.payload)}`;
  if(request.task==='critique')return shared+`TASK: Critique the counterpart proposal against the product brief, criteria, and referenceSpec. JSON shape: {"objections":[{"path":"...","reason":"...","severity":"blocking|warning"}],"acceptedPaths":["..."]}. Objection paths must occur in the proposed changes or exist in referenceSpec. acceptedPaths must come from the proposed changes and must not include a path with a blocking objection. Also return resolvedIssues: an array of exact strings from proposal.unresolved that this candidate and evidence settle. Return issueObjections: [{issue: <exact unresolved string>, reason: <concrete concern>}] for remaining blocking issues. For an open implementation concern covered by a caller-defined pending check, return deferredIssues: [{issue: <exact unresolved string>, checkId: <existing pending check ID>, reason: <why it is outside specification verification>}]. Do not also resolve or block the same issue; do not assign it to an unrelated change path. Never resolve an issue merely because a change path was accepted. Blocking objections should explain a concrete correction or measurable concern; do not invent accessibility failures. INPUT: ${JSON.stringify(request.payload)}`;
  return shared+`TASK: Revise your own proposal in response to the counterpart critique. Preserve useful accepted choices, resolve blocking objections where justified, and actively seek convergence without sacrificing deterministic requirements. JSON shape: {"summary":"...","changes":[{"path":"...","value":<json>,"rationale":"..."}],"tradeoffs":["..."],"unresolved":["..."]}. INPUT: ${JSON.stringify(request.payload)}`;
}
function stripJsonFences(text:string):string{const t=text.trim();const m=/^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);return (m?.[1]??t).trim();}
function ollamaCritiquePaths(payload:unknown):string[]{
  const proposal=isRecord(payload)?payload.proposal:undefined;
  const changes=isRecord(proposal)?proposal.changes:undefined;
  const paths=Array.isArray(changes)?[...new Set(changes.filter(isRecord).map(change=>change.path).filter((path):path is string=>typeof path==='string'))]:[];
  if(paths.length===0||paths.length>50)throw new Error('Ollama critique requires 1 to 50 proposed change paths');
  return paths;
}
function ollamaPendingCheckIds(payload:unknown):string[]{
  const proposal=isRecord(payload)?payload.proposal:undefined;
  return (validateReviewScope(isRecord(proposal)?proposal.reviewScope:undefined)?.pendingChecks??[]).map(c=>c.id);
}
function ollamaCritiqueIssues(payload:unknown):string[]{
  const proposal=isRecord(payload)?payload.proposal:undefined;
  return isRecord(proposal)&&Array.isArray(proposal.unresolved)?assertStringArray(proposal.unresolved,'unresolved'):[];
}
function ollamaIssueKeys(payload:unknown):string[]{
  const proposal=isRecord(payload)?payload.proposal:undefined;
  const declared=validateReviewScope(isRecord(proposal)?proposal.reviewScope:undefined)?.issues??[];
  return ollamaCritiqueIssues(payload).map((text,i)=>{const issue=declared.find(d=>d.text===text);return issue?'issue:'+issue.id:String(i);});
}
function ollamaChangePaths(request:{task:AgentTask;payload:unknown}):string[]{
  const context=request.task==='revision'&&isRecord(request.payload)?request.payload.context:request.payload;
  const contract=isRecord(context)?checkedProposalContract(context.proposalContract as ProposalContract|undefined):undefined;
  if(contract)return contract.allowedPaths;
  const referenceSpec=isRecord(context)?context.referenceSpec:undefined;
  if(!isRecord(referenceSpec))return [];
  const paths:string[]=[];
  if(isRecord(referenceSpec.tokens))for(const {path} of flattenTokenLeaves(referenceSpec.tokens))paths.push(`tokens.${path}.$value`);
  const collect=(value:unknown,prefix:string):void=>{
    if(isRecord(value)){for(const [key,child] of Object.entries(value))if(key!=='id'&&!['__proto__','prototype','constructor'].includes(key))collect(child,`${prefix}.${key}`);}
    else paths.push(prefix);
  };
  if(isRecord(referenceSpec.components))for(const [id,component] of Object.entries(referenceSpec.components))collect(component,`components.${id}`);
  if(isRecord(referenceSpec.components))for(const [id,component] of Object.entries(referenceSpec.components))if(isRecord(component)&&isRecord(component.accessibility)){
    paths.push(`components.${id}.accessibility.errorTextRequired`,`components.${id}.accessibility.errorAssociation`);
  }
  if(isRecord(referenceSpec.accessibility))for(const key of ['rules','contrastPairs'])if(Array.isArray(referenceSpec.accessibility[key]))paths.push(`accessibility.${key}`);
  if(isRecord(referenceSpec.patterns))for(const [id,pattern] of Object.entries(referenceSpec.patterns))if(isRecord(pattern)&&Array.isArray(pattern.rules))paths.push(`patterns.${id}.rules`);
  if(paths.length>500)throw new Error('Ollama change-path schema exceeds 500 paths');
  return [...new Set(paths)];
}
function ollamaContext(request:{task:AgentTask;payload:unknown}):Record<string,unknown>|undefined{
  const context=request.task==='revision'&&isRecord(request.payload)?request.payload.context:request.payload;
  return isRecord(context)?context:undefined;
}
function valueSchema(referenceSpec:unknown,path:string):Record<string,unknown>{
  const token=path.endsWith('.$value')?getPath(referenceSpec,path.slice(0,-7)):undefined;
  if(!isRecord(token)||typeof token.$type!=='string')return {};
  if(token.$type==='number')return {type:'number'};
  if(token.$type==='dimension'||token.$type==='duration'){
    const tokens=isRecord(referenceSpec)&&isRecord(referenceSpec.tokens)?referenceSpec.tokens:{};
    const references=flattenTokenLeaves(tokens).filter(leaf=>leaf.token.$type===token.$type&&`tokens.${leaf.path}.$value`!==path&&/^[A-Za-z0-9_.-]+$/.test(leaf.path)).map(leaf=>leaf.path.split('.').join('[.]'));
    const units=token.$type==='dimension'?'px|rem|em|%':'ms|s';
    const referencePattern=references.length?`|[{](${references.join('|')})[}]`:'';
    return {type:'string',pattern:`^(-?([0-9]+|[0-9]*[.][0-9]+)(${units})${referencePattern})$`};
  }
  if(token.$type==='cubicBezier')return {type:'array',minItems:4,maxItems:4,items:{type:'number'}};
  return {type:'string'};
}
function ollamaReviewValues(payload:unknown):Map<string,string|number|boolean|null>{
  const values=new Map<string,string|number|boolean|null>();
  if(!isRecord(payload)||!isRecord(payload.context)||!checkedProposalContract(payload.context.proposalContract as ProposalContract|undefined))return values;
  const changes=isRecord(payload.proposal)?payload.proposal.changes:undefined;
  if(Array.isArray(changes))for(const change of changes){
    if(!isRecord(change)||typeof change.path!=='string')continue;
    const value=change.value;
    if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))values.set(change.path,value);
  }
  return values;
}
function ollamaFormat(request:{task:AgentTask;payload:unknown}):Record<string,unknown>{
  const stringArray={type:'array',items:{type:'string'}};
  if(request.task==='critique'){
    const paths=ollamaCritiquePaths(request.payload);
    const issues=ollamaCritiqueIssues(request.payload);
    const values=ollamaReviewValues(request.payload);
    const verdict={type:'object',properties:{verdict:{type:'string',enum:['accept','warning','blocking']},reason:{type:'string',maxLength:180}},required:['verdict','reason'],additionalProperties:false};
    const reviewSchemas=paths.map(path=>{
      if(!values.has(path))return [path,verdict];
      const value=values.get(path);
      return [path,{type:'object',properties:{requestedValue:{type:'string',minLength:1,maxLength:120},observedValue:{type:value===null?'null':typeof value,enum:[value]},reason:{type:'string',minLength:1,maxLength:180},verdict:verdict.properties.verdict},required:['requestedValue','observedValue','reason','verdict'],additionalProperties:false}];
    });
    const issueVerdict={type:'object',properties:{verdict:{type:'string',enum:['resolved','blocking']},reason:{type:'string',minLength:1,maxLength:180}},required:['verdict','reason'],additionalProperties:false};
    const checkIds=ollamaPendingCheckIds(request.payload);
    const issueReviewSchema=checkIds.length?{anyOf:[issueVerdict,{type:'object',properties:{verdict:{type:'string',enum:['deferred']},checkId:{type:'string',enum:checkIds},reason:{type:'string',minLength:1,maxLength:1000}},required:['verdict','checkId','reason'],additionalProperties:false}]}:issueVerdict;
    const issueKeys=ollamaIssueKeys(request.payload);
    const clarificationRequests={type:'array',maxItems:4,items:{type:'object',properties:{reason:{type:'string',minLength:1,maxLength:1000},question:{type:'string',minLength:1,maxLength:500},requirements:{type:'array',minItems:2,maxItems:4,items:{type:'object',properties:{source:{type:'string',enum:['brief','criteria','validation']},quote:{type:'string',minLength:1,maxLength:1000}},required:['source','quote'],additionalProperties:false}}},required:['reason','question','requirements'],additionalProperties:false}};
    return {type:'object',properties:{reviews:{type:'object',properties:Object.fromEntries(reviewSchemas),required:paths,additionalProperties:false},clarificationRequests,...(issues.length?{issueReviews:{type:'object',properties:Object.fromEntries(issueKeys.map(key=>[key,issueReviewSchema])),required:issueKeys,additionalProperties:false}}:{})},required:['reviews',...(issues.length?['issueReviews']:[])],additionalProperties:false};
  }
  const paths=ollamaChangePaths(request);
  const context=ollamaContext(request),contract=checkedProposalContract(context?.proposalContract as ProposalContract|undefined);
  const ids=validateReviewScope(context?.reviewScope)?.issues?.map(i=>i.id)??[];
  const noteProperties=ids.length?{issueNotes:{type:'array',maxItems:100,items:{type:'object',properties:{issueId:{type:'string',enum:ids},note:{type:'string',minLength:1,maxLength:2000}},required:['issueId','note'],additionalProperties:false}}}:{};
  if(contract){
    const changeSchemas=paths.map(path=>({type:'object',properties:{path:{type:'string',enum:[path]},value:valueSchema(context?.referenceSpec,path)},required:['path','value'],additionalProperties:false}));
    const notes={type:'array',maxItems:3,items:{type:'string',maxLength:180}};
    return {type:'object',properties:{summary:{type:'string',maxLength:120},changes:{type:'array',minItems:contract.minChanges,maxItems:contract.maxChanges,items:{anyOf:changeSchemas}},tradeoffs:notes,unresolved:notes,...noteProperties},required:['summary','changes','tradeoffs','unresolved'],additionalProperties:false};
  }
  const newLeafPattern='^(?:tokens(?:\\.[A-Za-z][A-Za-z0-9_-]*){2,}|components\\.[A-Za-z0-9_-]+\\.tokens\\.[A-Za-z0-9_-]+)$';
  const pathSchema=paths.length?{anyOf:[{type:'string',enum:paths},{type:'string',pattern:newLeafPattern}]}:{type:'string'};
  return {type:'object',properties:{summary:{type:'string'},changes:{type:'array',minItems:1,items:{type:'object',properties:{path:pathSchema,value:{},rationale:{type:'string'}},required:['path','value'],additionalProperties:false}},tradeoffs:stringArray,unresolved:stringArray,...noteProperties},required:['summary','changes','tradeoffs','unresolved'],additionalProperties:false};
}
function ollamaPrompt(request:{role:string;model:string;task:AgentTask;payload:unknown}):string{
  if(request.task!=='critique')return taskPrompt(request);
  const paths=ollamaCritiquePaths(request.payload);
  const issues=ollamaCritiqueIssues(request.payload);
  const valueInstructions=scopeInstructions(request.payload,request.task)+clarificationInstructions+(ollamaReviewValues(request.payload).size?'For each scalar review, first state requestedValue from the brief (including any relationship), then copy observedValue from proposal.changes, then explain the comparison in reason, then choose verdict. referenceSpec contains the old values, not the requested targets. Accept when the candidate satisfies the request; block only a specific remaining defect. ':'');
  return `Role: ${request.role}. ${roleFocus(request.role)} Review the complete candidate against every brief criterion, referenceSpec and deterministicFeedback. Return only JSON matching RESPONSE_SCHEMA. ${valueInstructions}Review exactly ${JSON.stringify(paths)}. Accept correct values. Block specific defects; do not invent requirements or claim tests ran. ${issues.length?`Also return issueReviews keyed by the exact issue keys ${JSON.stringify(ollamaIssueKeys(request.payload))} in the same order as Issues (caller IDs are stable; other keys are legacy indices), each with verdict resolved or blocking and a specific reason. ${ollamaPendingCheckIds(request.payload).length?'A third verdict, deferred, is available for an implementation-only concern covered by reviewScope.pendingChecks: return {"verdict":"deferred","checkId":"existing-check-id","reason":"why only later implementation evidence is needed"}. Deferred is distinct from resolved and remains open and unverified.':'No pending checks were declared, so deferral is unavailable.'} Use blocking for specification defects and resolved only when supplied evidence settles the issue; a bare path is resolved if its change meets the brief. Issues: ${JSON.stringify(issues)}.`:''} INPUT: ${JSON.stringify(request.payload)}`;
}
function parseOllamaCritique(value:unknown,paths:string[],issues:string[],observedValues:Map<string,string|number|boolean|null>,checkIds:string[]=[],issueKeys:string[]=issues.map((_,i)=>String(i))):Record<string,unknown>{
  if(!isRecord(value)||!isRecord(value.reviews))throw new Error('Ollama critique must contain reviews');
  const reviews=value.reviews;
  if(Object.keys(reviews).some(path=>!paths.includes(path)))throw new Error('Ollama critique contains an unproposed path');
  const objections:{path:string;reason:string;severity:'warning'|'blocking'}[]=[],acceptedPaths:string[]=[];
  for(const path of paths){
    const review=reviews[path];
    if(!isRecord(review))throw new Error(`Ollama critique omitted path: ${path}`);
    assertString(review.reason,'review reason');
    if(observedValues.has(path)){
      if(!('observedValue' in review)||review.observedValue!==observedValues.get(path))throw new Error(`Ollama review observed value does not match candidate: ${path}`);
      assertString(review.requestedValue,'requested value');
    }
    if(review.verdict==='accept')acceptedPaths.push(path);
    else if(review.verdict==='warning'||review.verdict==='blocking')objections.push({path,reason:assertString(review.reason,`review reason for ${path}`),severity:review.verdict});
    else throw new Error(`Invalid Ollama critique verdict for ${path}`);
  }
  const resolvedIssues:string[]=[];
  const deferredIssues:{issue:string;checkId:string;reason:string}[]=[];
  const issueObjections:{issue:string;reason:string}[]=[];
  if(issues.length){
    if(!isRecord(value.issueReviews)||Object.keys(value.issueReviews).length!==issues.length)throw new Error('Ollama critique must review every unresolved issue');
    for(const [i,issue] of issues.entries()){
      const key=issueKeys[i];
      if(key===undefined)throw new Error('Missing unresolved issue key');
      const review=value.issueReviews[key];
      if(!isRecord(review))throw new Error(`Ollama critique omitted unresolved issue ${i}`);
      const reason=assertString(review.reason,'issue review reason');
      if(Object.keys(review).some(k=>!['verdict','reason',...(review.verdict==='deferred'?['checkId']:[])].includes(k)))throw new Error('Invalid issue review fields');
      if(review.verdict==='deferred'){
        if(typeof review.checkId!=='string'||!checkIds.includes(review.checkId)||reason.length>1000)throw new Error('Deferred issue requires a caller-defined pending check and bounded reason');
        deferredIssues.push({issue,checkId:review.checkId,reason});
      }
      else if(review.verdict==='resolved')resolvedIssues.push(issue);
      else if(review.verdict==='blocking')issueObjections.push({issue,reason});
      else throw new Error(`Invalid unresolved issue verdict ${i}`);
    }
  }
  return {objections,acceptedPaths,...(deferredIssues.length?{deferredIssues}:{}),...(value.clarificationRequests!==undefined?{clarificationRequests:value.clarificationRequests}:{}),...(issues.length?{resolvedIssues,issueObjections}:{})};
}
function parseProviderJson(text:string):unknown{try{return JSON.parse(stripJsonFences(text));}catch(error){throw new Error(`Provider did not return valid JSON: ${error instanceof Error?error.message:String(error)}`);}}
function openAIText(data:unknown):string{
  if(!isRecord(data))throw new Error('Invalid OpenAI response');
  if(typeof data.output_text==='string')return data.output_text;
  if(Array.isArray(data.output))for(const item of data.output){if(!isRecord(item)||!Array.isArray(item.content))continue;for(const part of item.content){if(isRecord(part)&&typeof part.text==='string')return part.text;}}
  throw new Error('OpenAI response contained no text output');
}
function anthropicText(data:unknown):string{if(!isRecord(data)||!Array.isArray(data.content))throw new Error('Invalid Anthropic response');const text=data.content.filter(isRecord).filter(v=>v.type==='text'&&typeof v.text==='string').map(v=>String(v.text)).join('\n');if(!text)throw new Error('Anthropic response contained no text output');return text;}

export function createOpenAIInvoker(config:{apiKey:string;endpoint?:string;reasoningEffort?:string}):AgentInvoker{
  const endpoint=config.endpoint??'https://api.openai.com/v1/responses';
  return async request=>{const body:Record<string,unknown>={model:request.model,input:taskPrompt(request)};if(config.reasoningEffort)body.reasoning={effort:config.reasoningEffort};const response=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${config.apiKey}`,'content-type':'application/json'},body:JSON.stringify(body)});const data:unknown=await response.json();if(!response.ok)throw new Error(`OpenAI provider error ${response.status}: ${JSON.stringify(data)}`);return parseProviderJson(openAIText(data));};
}
export function createAnthropicInvoker(config:{apiKey:string;endpoint?:string;maxTokens?:number}):AgentInvoker{
  const endpoint=config.endpoint??'https://api.anthropic.com/v1/messages';
  return async request=>{const response=await fetch(endpoint,{method:'POST',headers:{'x-api-key':config.apiKey,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model:request.model,max_tokens:config.maxTokens??8192,messages:[{role:'user',content:taskPrompt(request)}]})});const data:unknown=await response.json();if(!response.ok)throw new Error(`Anthropic provider error ${response.status}: ${JSON.stringify(data)}`);return parseProviderJson(anthropicText(data));};
}

export function createOllamaInvoker(config:{endpoint?:string;timeoutMs?:number;numPredict?:number;maxResponseChars?:number;cpuOnly?:boolean;fetchImpl?:typeof fetch}={}):AgentInvoker{
  const endpoint=new URL(config.endpoint??'http://127.0.0.1:11434/api/generate');
  if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.pathname!=='/api/generate'||endpoint.username||endpoint.password)throw new Error('Ollama endpoint must be local /api/generate without URL credentials');
  const timeoutMs=config.timeoutMs??180000,numPredict=config.numPredict??1200,maxResponseChars=config.maxResponseChars??100000;
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw new Error('Ollama timeout must be 1000 to 300000 ms');
  if(!Number.isInteger(numPredict)||numPredict<100||numPredict>4096)throw new Error('Ollama numPredict must be 100 to 4096');
  if(!Number.isInteger(maxResponseChars)||maxResponseChars<100||maxResponseChars>1000000)throw new Error('Ollama response character limit must be 100 to 1000000');
  if(config.cpuOnly!==undefined&&typeof config.cpuOnly!=='boolean')throw new Error('Ollama cpuOnly must be a boolean');
  const requestFetch=config.fetchImpl??fetch;
  return async request=>{
    const format=ollamaFormat(request);
    const prompt=ollamaPrompt(request)+(request.task==='critique'?`\nRESPONSE_SCHEMA: ${JSON.stringify(format)}`:'');
    const response=await requestFetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:request.model,prompt,format,stream:false,options:{temperature:0,num_predict:numPredict,...(config.cpuOnly?{num_gpu:0}:{})}}),signal:AbortSignal.timeout(timeoutMs)});
    if(!response.ok)throw new Error(`Ollama provider error ${response.status}`);
    const data:unknown=await response.json();
    if(!isRecord(data)||typeof data.response!=='string')throw new Error('Ollama response contained no text output');
    if(data.response.length>maxResponseChars)throw new Error(`Ollama response exceeded ${maxResponseChars} characters`);
    const parsed=parseProviderJson(data.response);
    if(request.task==='critique')assertReviewHasNoControlMarkers(parsed);
    return request.task==='critique'?parseOllamaCritique(parsed,ollamaCritiquePaths(request.payload),ollamaCritiqueIssues(request.payload),ollamaReviewValues(request.payload),ollamaPendingCheckIds(request.payload),ollamaIssueKeys(request.payload)):parsed;
  };
}

declare const process:{env:Record<string,string|undefined>};
export function createConfiguredAgent(role:'astra'|'fable',env:Record<string,string|undefined>=process.env):DesignAgent{
  const prefix=role.toUpperCase();const provider=String(env[`${prefix}_PROVIDER`]??(role==='astra'?'openai':'anthropic')).toLowerCase();const model=env[`${prefix}_MODEL`];if(!model)throw new Error(`${prefix}_MODEL is required`);
  if(provider==='openai'){const key=env[`${prefix}_API_KEY`]??env.OPENAI_API_KEY;if(!key)throw new Error(`${prefix}_API_KEY or OPENAI_API_KEY is required`);const endpoint=env.OPENAI_RESPONSES_URL,reasoningEffort=env[`${prefix}_REASONING_EFFORT`];return new OpenAIAdapter(role,model,createOpenAIInvoker({apiKey:key,...(endpoint?{endpoint}:{}),...(reasoningEffort?{reasoningEffort}:{})}));}
  if(provider==='anthropic'){const key=env[`${prefix}_API_KEY`]??env.ANTHROPIC_API_KEY;if(!key)throw new Error(`${prefix}_API_KEY or ANTHROPIC_API_KEY is required`);const endpoint=env.ANTHROPIC_MESSAGES_URL;return new AnthropicAdapter(role,model,createAnthropicInvoker({apiKey:key,...(endpoint?{endpoint}:{}),maxTokens:Number(env[`${prefix}_MAX_TOKENS`]??8192)}));}
  if(provider==='ollama')return new OllamaAdapter(role,model,createOllamaInvoker({...(env.OLLAMA_GENERATE_URL?{endpoint:env.OLLAMA_GENERATE_URL}:{}),timeoutMs:Number(env[`${prefix}_TIMEOUT_MS`]??180000),numPredict:Number(env[`${prefix}_NUM_PREDICT`]??1200)}));
  throw new Error(`Unsupported provider for ${role}: ${provider}`);
}

export interface MockAgentOptions { initial: DesignProposal; convergeTo?: Record<string,unknown>; convergeAfterRound?: number; }
export class MockAgent implements DesignAgent {
  readonly seenInitialContexts: unknown[]=[];
  constructor(public id:string,private options:MockAgentOptions){}
  async generateProposal(context:Readonly<DesignContext>):Promise<DesignProposal>{this.seenInitialContexts.push(deepClone(context)); return deepClone({...this.options.initial,author:this.id});}
  async critiqueProposal(proposal:Readonly<DesignProposal>):Promise<Critique>{const objections=proposal.changes.filter(c=>this.options.convergeTo && c.path in this.options.convergeTo && JSON.stringify(c.value)!==JSON.stringify(this.options.convergeTo[c.path])).map(c=>({path:c.path,reason:'Does not match deterministic mock convergence target',severity:'blocking' as const}));return {reviewer:this.id,proposalId:proposal.id,candidateHash:await sha256(candidateFromProposal(proposal)),objections,acceptedPaths:proposal.changes.filter(c=>!objections.some(o=>o.path===c.path)).map(c=>c.path)};}
  async reviseProposal(proposal:Readonly<DesignProposal>,_critique:Readonly<Critique>,_context:Readonly<DesignContext>,round:number):Promise<DesignProposal>{const next=deepClone(proposal) as DesignProposal; if(this.options.convergeTo && round>=(this.options.convergeAfterRound??1)) next.changes=next.changes.map(c=>c.path in this.options.convergeTo! ? {...c,value:deepClone(this.options.convergeTo![c.path])}:c); return next;}
}
