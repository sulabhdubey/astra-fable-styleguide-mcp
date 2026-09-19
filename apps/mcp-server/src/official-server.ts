import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
import { StyleService, type SpecBundle } from './service.js';
import { canonicalize, mergeObjects } from '../../../packages/style-spec/src/index.js';
import { verifySnapshot, type SnapshotIndexEntry, type StyleSnapshot } from '../../../packages/versioning/src/index.js';
import { createConfiguredAgent } from '../../../packages/provider-adapters/src/index.js';

async function json(path:string){return JSON.parse(await readFile(path,'utf8')) as Record<string,unknown>;}
async function text(path:string){return readFile(path,'utf8');}
async function loadBundle():Promise<SpecBundle>{
 const cwd=process.cwd(),spec=resolve(cwd,'spec'); const tokens:Record<string,unknown>={};
 for(const file of (await readdir(resolve(spec,'tokens'))).filter(f=>f.endsWith('.json')).sort()) mergeObjects(tokens,await json(resolve(spec,'tokens',file)));
 const components=await Promise.all((await readdir(resolve(spec,'components'))).filter(f=>f.endsWith('.json')).sort().map(f=>json(resolve(spec,'components',f))));
 const patterns=await Promise.all((await readdir(resolve(spec,'patterns'))).filter(f=>f.endsWith('.json')).sort().map(f=>json(resolve(spec,'patterns',f))));
 const decisionIndex=await json(resolve(cwd,'decisions/index.json')); const decisions:Record<string,string>={};
 for(const name of (decisionIndex.decisions as string[])) decisions[name]=await text(resolve(cwd,'decisions',name));
 return {manifest:await json(resolve(spec,'manifest.json')),principles:await json(resolve(spec,'principles.json')),tokens,components,patterns,antiPatterns:await json(resolve(spec,'anti-patterns/common.json')),accessibility:await json(resolve(spec,'accessibility/rules.json')),decisions};
}
async function loadSpecFiles(dir:string,prefix=''):Promise<Record<string,unknown>>{
 const files:Record<string,unknown>={};
 for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   if(entry.isDirectory())Object.assign(files,await loadSpecFiles(resolve(dir,entry.name),`${prefix}${entry.name}/`));
   else if(entry.isFile()&&entry.name.endsWith('.json'))files[`${prefix}${entry.name}`]=await json(resolve(dir,entry.name));
 }
 return files;
}
async function loadSnapshots():Promise<Map<string,StyleSnapshot>>{
 const cwd=process.cwd(),index=await json(resolve(cwd,'releases/manifest.json'));
 if(!Array.isArray(index.releases))throw new Error('Invalid release snapshot index');
 const snapshots=new Map<string,StyleSnapshot>();
 for(const raw of index.releases){
   if(!raw||typeof raw!=='object')throw new Error('Invalid release snapshot entry');
   const entry=raw as Record<string,unknown>;
   const version=entry.version,path=entry.path;
   if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version)||path!==`${version}-style-spec.json`)throw new Error('Invalid release snapshot metadata');
   if(snapshots.has(version))throw new Error(`Duplicate release snapshot: ${version}`);
   const bytes=await readFile(resolve(cwd,'releases',path));
   const snapshot=verifySnapshot(entry as unknown as SnapshotIndexEntry,bytes);
   snapshots.set(version,snapshot);
 }
 const files=await loadSpecFiles(resolve(cwd,'spec'));
 const version=String((files['manifest.json'] as Record<string,unknown>).version??'');
 const current:StyleSnapshot={version,files};
 const historical=snapshots.get(version);
 if(historical&&canonicalize(historical.files)!==canonicalize(current.files))throw new Error(`Canonical /spec differs from immutable snapshot ${version}; bump the version before changing /spec`);
 return snapshots;
}
const bundle=await loadBundle(); const service=new StyleService(bundle,await loadSnapshots());
const asText=(data:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(data,null,2)}]});
const bearer=(ctx:any)=>ctx.http?.req?.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
const humanApproval=(ctx:any)=>ctx.http?.req?.headers.get('x-human-approval-token')??undefined;
const adminToken=process.env.MCP_ADMIN_TOKEN; const releaseApprovalToken=process.env.MCP_RELEASE_APPROVAL_TOKEN;

function buildServer(){
 const server=new McpServer({name:'astra-fable-style-constitution',version:String(bundle.manifest.version)});
 const resources:[string,string,unknown][]=[['manifest','style://manifest',bundle.manifest],['principles','style://principles',bundle.principles],['tokens','style://tokens',bundle.tokens],['components','style://components',bundle.components],['patterns','style://patterns',bundle.patterns],['accessibility','style://accessibility',bundle.accessibility],['anti-patterns','style://anti-patterns',bundle.antiPatterns],['decisions','style://decisions',bundle.decisions],['version','style://version',{version:bundle.manifest.version}]];
 for(const [name,uri,data] of resources) server.registerResource(name,uri,{title:name,mimeType:'application/json'},async u=>({contents:[{uri:u.href,mimeType:'application/json',text:JSON.stringify(data,null,2)}]}));
 for(const component of bundle.components){const id=String(component.id);server.registerResource(`component-${id}`,`style://components/${id}`,{title:`Component: ${id}`,mimeType:'application/json'},async u=>({contents:[{uri:u.href,mimeType:'application/json',text:JSON.stringify(component,null,2)}]}));}
 server.registerTool('get_style_manifest',{description:'Return the canonical style manifest'},async()=>asText(service.getManifest()));
 server.registerTool('get_design_tokens',{description:'Return all tokens or one token scope',inputSchema:z.object({scope:z.string().optional()})},async({scope})=>asText(service.getDesignTokens(scope)));
 server.registerTool('get_component_rules',{description:'Return canonical rules for a component',inputSchema:z.object({component:z.string()})},async({component})=>asText(service.getComponentRules(component)));
 server.registerTool('search_style_spec',{description:'Search components and decision records',inputSchema:z.object({query:z.string().min(1)})},async({query})=>asText(service.search(query)));
 server.registerTool('explain_style_decision',{description:'Explain an ADR by id/filename',inputSchema:z.object({id:z.string()})},async({id})=>asText(service.explainDecision(id)));
 server.registerTool('validate_tokens',{description:'Run deterministic validation of the canonical StyleSpec'},async()=>asText(service.validate()));
 server.registerTool('check_style_compliance',{description:'Check CSS in supplied source for canonical color and pixel literals; returns source locations and explicit coverage limits',inputSchema:z.object({input:z.string().max(200000)})},async({input})=>asText(service.checkStyleCompliance(input)));
 server.registerTool('compare_spec_versions',{description:'Compare known immutable StyleSpec snapshots',inputSchema:z.object({fromVersion:z.string(),toVersion:z.string()})},async({fromVersion,toVersion})=>asText(service.compareSpecVersions(fromVersion,toVersion)));
 if(process.env.MCP_ENABLE_WRITES==='true'){
   server.registerTool('create_style_proposal',{description:'Create a governed style proposal (admin only)',inputSchema:z.object({id:z.string(),proposalJson:z.string()})},async({id,proposalJson},ctx)=>asText(service.createProposal(id,JSON.parse(proposalJson),bearer(ctx),adminToken)));
   server.registerTool('evaluate_style_proposal',{description:'Evaluate a stored style proposal (admin only)',inputSchema:z.object({id:z.string()})},async({id},ctx)=>asText(service.evaluateProposal(id,bearer(ctx),adminToken)));
   server.registerTool('start_consensus_round',{description:'Merge stored Astra/Fable proposals and create an exact-hash candidate when conflict-free (admin only)',inputSchema:z.object({astraProposalId:z.string(),fableProposalId:z.string()})},async({astraProposalId,fableProposalId},ctx)=>asText(await service.startConsensusRound(astraProposalId,fableProposalId,bearer(ctx),adminToken)));
   server.registerTool('get_consensus_status',{description:'Return exact-hash candidate status and role-approval readiness (admin only; process-local prototype)',inputSchema:z.object({candidateHash:z.string()})},async({candidateHash},ctx)=>asText(service.getConsensusStatus(candidateHash,bearer(ctx),adminToken)));
   server.registerTool('get_governance_activity',{description:'Return recent proposal, round, conflict, and candidate summaries (admin only; process-local prototype)',inputSchema:z.object({})},async(_input,ctx)=>asText(service.getGovernanceActivity(bearer(ctx),adminToken)));
   server.registerTool('approve_candidate',{description:'Record Astra/Fable approval against the exact candidate hash (admin only)',inputSchema:z.object({candidateHash:z.string(),actor:z.enum(['astra','fable'])})},async({candidateHash,actor},ctx)=>asText(service.approveCandidate(candidateHash,actor,bearer(ctx),adminToken)));
   if(process.env.MCP_ENABLE_RELEASE_TOOL==='true') server.registerTool('publish_release',{description:'Mark an approved candidate released after explicit human approval; requires admin auth plus a separate X-Human-Approval-Token',inputSchema:z.object({candidateHash:z.string(),humanApproved:z.boolean()})},async({candidateHash,humanApproved},ctx)=>asText(service.publishRelease(candidateHash,humanApproved,bearer(ctx),adminToken,humanApproval(ctx),releaseApprovalToken)));
   if(process.env.MCP_ENABLE_AI_ORCHESTRATION==='true') server.registerTool('generate_style_constitution_candidate',{description:'Run independent Astra/Fable proposals, cross-review, deterministic validation, and bounded consensus from one product brief (admin only)',inputSchema:z.object({brief:z.string().min(20).max(50000),criteria:z.array(z.string()).default(['accessibility','consistency','maintainability']),maxRounds:z.number().int().min(1).max(10).default(5)})},async({brief,criteria,maxRounds},ctx)=>asText(await service.generateCandidateFromBrief({brief,criteria,maxRounds,astra:createConfiguredAgent('astra'),fable:createConfiguredAgent('fable')},bearer(ctx),adminToken)));
 }
 return server;
}

const handler=createMcpHandler(buildServer,{responseMode:'json'}); const nodeHandler=toNodeHandler(handler);
const port=Number(process.env.PORT??3000); const host=process.env.HOST??'127.0.0.1';
const validateHost=localhostHostValidation(); const validateOrigin=localhostOriginValidation();
const allowedHostValues=[process.env.MCP_ALLOWED_HOSTS??'127.0.0.1,localhost',process.env.VERCEL_URL,process.env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).flatMap(v=>String(v).split(',')).map(v=>v.trim().replace(/^https?:\/\//,'').replace(/\/.*$/,'')).filter(Boolean);
const allowedHosts=new Set(allowedHostValues);
function publicHeadersAllowed(req:any,res:any){const raw=String(req.headers.host??'');const hostname=raw.replace(/:\d+$/,'');if(!allowedHosts.has(hostname)){res.writeHead(403).end('Forbidden host');return false;}const origin=req.headers.origin;if(origin){try{const oh=new URL(String(origin)).hostname;if(!allowedHosts.has(oh)){res.writeHead(403).end('Forbidden origin');return false;}}catch{res.writeHead(403).end('Forbidden origin');return false;}}return true;}
const rateLimitPerMinute=Number(process.env.MCP_RATE_LIMIT_PER_MINUTE??120); const buckets=new Map<string,{start:number;count:number}>();
function rateAllowed(key:string){const now=Date.now();const b=buckets.get(key);if(!b||now-b.start>=60000){buckets.set(key,{start:now,count:1});return true;}b.count++;return b.count<=rateLimitPerMinute;}
createServer((req,res)=>{
 const started=Date.now();const requestId=crypto.randomUUID();const path=req.url??'/';
 res.on('finish',()=>console.error(JSON.stringify({request_id:requestId,method:req.method,path,status:res.statusCode,duration_ms:Date.now()-started,protocol:'2026-07-28'})));
 const peer=req.socket.remoteAddress??'unknown'; if(!rateAllowed(peer)){res.writeHead(429,{'content-type':'application/json','retry-after':'60'}).end(JSON.stringify({error:'rate_limited',request_id:requestId}));return;}
 if(path==='/health'&&req.method==='GET'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({ok:true,version:bundle.manifest.version,protocol:'2026-07-28'}));return;}
 if(path==='/version'&&req.method==='GET'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({version:bundle.manifest.version}));return;}
 if(host==='127.0.0.1'){if(!validateHost(req,res)||!validateOrigin(req,res))return;} else if(!publicHeadersAllowed(req,res))return;
 if(!path.startsWith('/mcp')){res.writeHead(404).end();return;}
 if(!req.method){res.writeHead(400).end('Missing HTTP method');return;}
 if(!req.url){res.writeHead(400).end('Missing request URL');return;}
 const mcpReq=Object.assign(req,{method:req.method,url:req.url}); void nodeHandler(mcpReq,res);
}).listen(port,host,()=>console.error(`Style Constitution MCP listening on http://${host}:${port}/mcp`));
