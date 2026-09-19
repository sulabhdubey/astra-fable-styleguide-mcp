import type { Critique, DesignAgent, DesignContext, DesignProposal } from '../../consensus-engine/src/index.js';
import { deepClone, flattenTokenLeaves, getPath, isRecord } from '../../style-spec/src/index.js';

export interface ProviderConfig { provider: string; model: string; }
export type AgentTask='proposal'|'critique'|'revision';
export type AgentInvoker = (request:{role:string;model:string;task:AgentTask;payload:unknown})=>Promise<unknown>;

function assertString(value:unknown,label:string):string{if(typeof value!=='string'||!value.trim())throw new Error(`Provider returned invalid ${label}`);return value;}
function assertStringArray(value:unknown,label:string):string[]{if(!Array.isArray(value)||value.some(v=>typeof v!=='string'))throw new Error(`Provider returned invalid ${label}`);return value as string[];}
function normalizeProposal(value:unknown,role:string,baseVersion:string,referenceSpec?:unknown,previousId?:string):DesignProposal{
  if(!isRecord(value))throw new Error('Provider proposal must be an object');
  const rawChanges=value.changes;if(!Array.isArray(rawChanges)||rawChanges.length===0)throw new Error('Provider proposal must contain at least one change');
  const changes=rawChanges.map((change,i)=>{if(!isRecord(change))throw new Error(`Invalid change at ${i}`);if(!('value' in change)||change.value===undefined)throw new Error(`Provider returned invalid changes[${i}].value`);return {path:assertString(change.path,`changes[${i}].path`),value:deepClone(change.value),...(typeof change.rationale==='string'?{rationale:change.rationale}:{})};});
  if(referenceSpec!==undefined)for(const change of changes)if(getPath(referenceSpec,change.path)===undefined)throw new Error(`Unknown proposal change path: ${change.path}`);
  return {id:previousId??(typeof value.id==='string'&&value.id?value.id:`PROP-${role}-${crypto.randomUUID()}`),author:role,baseVersion,summary:assertString(value.summary,'summary'),changes,tradeoffs:Array.isArray(value.tradeoffs)?assertStringArray(value.tradeoffs,'tradeoffs'):[],unresolved:Array.isArray(value.unresolved)?assertStringArray(value.unresolved,'unresolved'):[]};
}
function normalizeCritique(value:unknown,role:string,proposal:DesignProposal,referenceSpec:unknown):Critique{
  if(!isRecord(value))throw new Error('Provider critique must be an object');
  const raw=Array.isArray(value.objections)?value.objections:[];
  const objections=raw.map((o,i)=>{if(!isRecord(o))throw new Error(`Invalid objection at ${i}`);const severity=o.severity==='warning'?'warning':'blocking';return {path:assertString(o.path,`objections[${i}].path`),reason:assertString(o.reason,`objections[${i}].reason`),severity} as const;});
  const acceptedPaths=Array.isArray(value.acceptedPaths)?assertStringArray(value.acceptedPaths,'acceptedPaths'):[];
  const proposedPaths=new Set(proposal.changes.map(change=>change.path));
  for(const objection of objections)if(!proposedPaths.has(objection.path)&&getPath(referenceSpec,objection.path)===undefined)throw new Error(`Unknown critique path: ${objection.path}`);
  for(const path of acceptedPaths)if(!proposedPaths.has(path))throw new Error(`Accepted path was not proposed: ${path}`);
  for(const objection of objections)if(objection.severity==='blocking'&&acceptedPaths.includes(objection.path))throw new Error(`Contradictory critique for path: ${objection.path}`);
  return {reviewer:role,proposalId:proposal.id,objections,acceptedPaths};
}

export class ConfigurableAgent implements DesignAgent {
  constructor(public id:string, private config:ProviderConfig, private invoke:AgentInvoker){}
  async generateProposal(context:Readonly<DesignContext>):Promise<DesignProposal>{return normalizeProposal(await this.invoke({role:this.id,model:this.config.model,task:'proposal',payload:context}),this.id,context.baseVersion,context.referenceSpec);}
  async critiqueProposal(proposal:Readonly<DesignProposal>,context:Readonly<DesignContext>):Promise<Critique>{return normalizeCritique(await this.invoke({role:this.id,model:this.config.model,task:'critique',payload:{proposal,context}}),this.id,proposal,context.referenceSpec);}
  async reviseProposal(proposal:Readonly<DesignProposal>,critique:Readonly<Critique>,context:Readonly<DesignContext>,round:number):Promise<DesignProposal>{return normalizeProposal(await this.invoke({role:this.id,model:this.config.model,task:'revision',payload:{proposal,critique,context,round}}),this.id,context.baseVersion,context.referenceSpec,proposal.id);}
}

export class OpenAIAdapter extends ConfigurableAgent {constructor(id:string,model:string,invoke:AgentInvoker){super(id,{provider:'openai',model},invoke);}}
export class AnthropicAdapter extends ConfigurableAgent {constructor(id:string,model:string,invoke:AgentInvoker){super(id,{provider:'anthropic',model},invoke);}}
export class OllamaAdapter extends ConfigurableAgent {constructor(id:string,model:string,invoke:AgentInvoker){super(id,{provider:'ollama',model},invoke);}}

function taskPrompt(request:{role:string;model:string;task:AgentTask;payload:unknown}):string{
  const shared=`You are the ${request.role.toUpperCase()} role in a governed two-agent design-system consensus process. Your counterpart is independent. Return ONLY one valid JSON object, with no Markdown fences and no commentary. Never claim a test ran. Prefer accessibility, semantic tokens, consistency, maintainability, and explicit tradeoffs. Paths must address EXISTING values in referenceSpec and must start with tokens. or components.<component-id>. Do not modify version/status/governance. When changing an existing token leaf, target its .$value path.\n`;
  if(request.task==='proposal')return shared+`TASK: Produce an independent proposal before seeing the counterpart's proposal. JSON shape: {"summary":"...","changes":[{"path":"tokens....$value","value":<json>,"rationale":"..."}],"tradeoffs":["..."],"unresolved":["..."]}. Include at least one change and keep the proposal focused. INPUT: ${JSON.stringify(request.payload)}`;
  if(request.task==='critique')return shared+`TASK: Critique the counterpart proposal against the product brief, criteria, and referenceSpec. JSON shape: {"objections":[{"path":"...","reason":"...","severity":"blocking|warning"}],"acceptedPaths":["..."]}. Objection paths must occur in the proposed changes or exist in referenceSpec. acceptedPaths must come from the proposed changes and must not include a path with a blocking objection. Blocking objections should explain a concrete correction or measurable concern; do not invent accessibility failures. INPUT: ${JSON.stringify(request.payload)}`;
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
function ollamaChangePaths(request:{task:AgentTask;payload:unknown}):string[]{
  const context=request.task==='revision'&&isRecord(request.payload)?request.payload.context:request.payload;
  const referenceSpec=isRecord(context)?context.referenceSpec:undefined;
  if(!isRecord(referenceSpec))return [];
  const paths:string[]=[];
  if(isRecord(referenceSpec.tokens))for(const {path} of flattenTokenLeaves(referenceSpec.tokens))paths.push(`tokens.${path}.$value`);
  const collect=(value:unknown,prefix:string):void=>{
    if(isRecord(value)){for(const [key,child] of Object.entries(value))if(key!=='id'&&!['__proto__','prototype','constructor'].includes(key))collect(child,`${prefix}.${key}`);}
    else paths.push(prefix);
  };
  if(isRecord(referenceSpec.components))for(const [id,component] of Object.entries(referenceSpec.components))collect(component,`components.${id}`);
  if(paths.length>500)throw new Error('Ollama change-path schema exceeds 500 paths');
  return paths;
}
function ollamaFormat(request:{task:AgentTask;payload:unknown}):Record<string,unknown>{
  const stringArray={type:'array',items:{type:'string'}};
  if(request.task==='critique'){
    const paths=ollamaCritiquePaths(request.payload);
    const verdict={type:'object',properties:{verdict:{type:'string',enum:['accept','warning','blocking']},reason:{type:'string'}},required:['verdict','reason'],additionalProperties:false};
    return {type:'object',properties:{reviews:{type:'object',properties:Object.fromEntries(paths.map(path=>[path,verdict])),required:paths,additionalProperties:false}},required:['reviews'],additionalProperties:false};
  }
  const paths=ollamaChangePaths(request);
  const pathSchema=paths.length?{type:'string',enum:paths}:{type:'string'};
  return {type:'object',properties:{summary:{type:'string'},changes:{type:'array',minItems:1,items:{type:'object',properties:{path:pathSchema,value:{},rationale:{type:'string'}},required:['path','value']}},tradeoffs:stringArray,unresolved:stringArray},required:['summary','changes','tradeoffs','unresolved']};
}
function ollamaPrompt(request:{role:string;model:string;task:AgentTask;payload:unknown}):string{
  if(request.task!=='critique')return taskPrompt(request);
  const paths=ollamaCritiquePaths(request.payload);
  return `You are the ${request.role.toUpperCase()} role. Review the counterpart proposal independently against the brief and referenceSpec. Return only a JSON object with a reviews object. Use exactly these keys: ${JSON.stringify(paths)}. For each key provide {"verdict":"accept|warning|blocking","reason":"..."}. Choose accept if the proposed change meets the brief and no concrete concern exists. Use blocking only for a specific correction; do not invent accessibility failures. A path has one verdict only. INPUT: ${JSON.stringify(request.payload)}`;
}
function parseOllamaCritique(value:unknown,paths:string[]):unknown{
  if(!isRecord(value)||!isRecord(value.reviews))throw new Error('Ollama critique must contain reviews');
  const reviews=value.reviews;
  if(Object.keys(reviews).some(path=>!paths.includes(path)))throw new Error('Ollama critique contains an unproposed path');
  const objections:{path:string;reason:string;severity:'warning'|'blocking'}[]=[],acceptedPaths:string[]=[];
  for(const path of paths){
    const review=reviews[path];
    if(!isRecord(review))throw new Error(`Ollama critique omitted path: ${path}`);
    if(review.verdict==='accept')acceptedPaths.push(path);
    else if(review.verdict==='warning'||review.verdict==='blocking')objections.push({path,reason:assertString(review.reason,`review reason for ${path}`),severity:review.verdict});
    else throw new Error(`Invalid Ollama critique verdict for ${path}`);
  }
  return {objections,acceptedPaths};
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

export function createOllamaInvoker(config:{endpoint?:string;timeoutMs?:number;numPredict?:number;fetchImpl?:typeof fetch}={}):AgentInvoker{
  const endpoint=new URL(config.endpoint??'http://127.0.0.1:11434/api/generate');
  if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.pathname!=='/api/generate'||endpoint.username||endpoint.password)throw new Error('Ollama endpoint must be local /api/generate without URL credentials');
  const timeoutMs=config.timeoutMs??180000,numPredict=config.numPredict??1200;
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw new Error('Ollama timeout must be 1000 to 300000 ms');
  if(!Number.isInteger(numPredict)||numPredict<100||numPredict>4096)throw new Error('Ollama numPredict must be 100 to 4096');
  const requestFetch=config.fetchImpl??fetch;
  return async request=>{
    const response=await requestFetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:request.model,prompt:ollamaPrompt(request),format:ollamaFormat(request),stream:false,options:{temperature:0,num_predict:numPredict}}),signal:AbortSignal.timeout(timeoutMs)});
    if(!response.ok)throw new Error(`Ollama provider error ${response.status}`);
    const data:unknown=await response.json();
    if(!isRecord(data)||typeof data.response!=='string')throw new Error('Ollama response contained no text output');
    const parsed=parseProviderJson(data.response);
    return request.task==='critique'?parseOllamaCritique(parsed,ollamaCritiquePaths(request.payload)):parsed;
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
  async critiqueProposal(proposal:Readonly<DesignProposal>):Promise<Critique>{const objections=proposal.changes.filter(c=>this.options.convergeTo && c.path in this.options.convergeTo && JSON.stringify(c.value)!==JSON.stringify(this.options.convergeTo[c.path])).map(c=>({path:c.path,reason:'Does not match deterministic mock convergence target',severity:'blocking' as const}));return {reviewer:this.id,proposalId:proposal.id,objections,acceptedPaths:proposal.changes.filter(c=>!objections.some(o=>o.path===c.path)).map(c=>c.path)};}
  async reviseProposal(proposal:Readonly<DesignProposal>,_critique:Readonly<Critique>,_context:Readonly<DesignContext>,round:number):Promise<DesignProposal>{const next=deepClone(proposal) as DesignProposal; if(this.options.convergeTo && round>=(this.options.convergeAfterRound??1)) next.changes=next.changes.map(c=>c.path in this.options.convergeTo! ? {...c,value:deepClone(this.options.convergeTo![c.path])}:c); return next;}
}
