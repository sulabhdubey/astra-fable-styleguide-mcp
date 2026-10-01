import test from 'node:test';
import assert from 'node:assert/strict';
import {runConsensus,sha256,candidateFromProposal,reviewIsComplete} from '../dist/packages/consensus-engine/src/index.js';
import {ConfigurableAgent,createGovernedHostInvoker} from '../dist/packages/provider-adapters/src/index.js';
import {StyleService} from '../dist/apps/mcp-server/src/service.js';
import {loadBundle} from './helpers.mjs';

const issue='Browser focus measurements remain pending.';
const scope={stage:'specification',pendingChecks:[{id:'focus',requirement:'Visible focus on adjacent rendered surfaces.',evidenceRequired:'Browser focus measurements.'},{id:'layout',requirement:'Content fits narrow viewports.',evidenceRequired:'Browser overflow measurements.'}]};
const context={brief:'Change the medium radius to 13px.',criteria:['Preserve unrelated rules.'],baseVersion:'0.6.0',reviewScope:scope};
const path='tokens.radius.md.$value';
const proposal=role=>({id:role,author:role,baseVersion:context.baseVersion,summary:'Radius',changes:[{path,value:'13px'}],unresolved:[issue],tradeoffs:[]});
const deferred={issue,checkId:'focus',reason:'Only the caller-declared rendered evidence is missing; this concern remains open.'};
function agent(role,overrides={}){
 return {id:role,generateProposal:async()=>proposal(role),critiqueProposal:async p=>({reviewer:role,proposalId:p.id,candidateHash:await sha256(candidateFromProposal(p)),acceptedPaths:[path],objections:[],deferredIssues:[deferred],...overrides}),reviseProposal:async p=>({...p,unresolved:[]})};
}
const run=(a={},b={},extra={})=>runConsensus({context,astra:agent('astra',a),fable:agent('fable',b),maxRounds:1,...extra});

test('dual deferral permits specification consensus and retains two open, unverified review records',async()=>{
 const r=await run();assert.equal(r.status,'CONSENSUS');
 assert.equal(r.reviewReadiness.renderedVerified,false);assert.equal(r.reviewReadiness.deferredIssues.length,2);
 for(const e of r.reviewReadiness.deferredIssues){assert.equal(e.issue,issue);assert.equal(e.checkId,'focus');assert.equal(e.status,'open');assert.equal(e.evidenceKind,'unverified');assert.equal(e.candidateHash,r.candidateHash);}
 assert.ok(r.initial.every(p=>p.unresolved.includes(issue)));assert.ok(r.reviewReadiness.pendingChecks.every(c=>c.status==='pending'));
 assert.ok(r.critiques.every(c=>!c.resolvedIssues?.includes(issue)));
});

test('one-sided deferral, resolved-versus-deferred and different check IDs do not agree',async()=>{
 for(const other of [{deferredIssues:[]},{deferredIssues:[],resolvedIssues:[issue]},{deferredIssues:[{...deferred,checkId:'layout'}]}])assert.equal((await run({},other)).status,'PARTIAL_CONSENSUS');
});

test('invalid or contradictory deferral fails closed even for custom agents',async()=>{
 for(const bad of [null,{},[{}],[{...deferred,checkId:'unknown'}],[{...deferred,issue:'Unknown issue'}],[{...deferred,reason:''}],[deferred,deferred],[{...deferred,status:'verified'}]])await assert.rejects(run({deferredIssues:bad}),/defer|issue|check/i);
 await assert.rejects(run({resolvedIssues:[issue]}),/defer|contradict/i);
 await assert.rejects(run({issueObjections:[{issue,reason:'Still a defect'}]}),/defer|contradict/i);
 const unscoped={...context};delete unscoped.reviewScope;
 await assert.rejects(run({}, {}, {context:unscoped}),/defer|scope|check/i);
});

test('deferral cannot override deterministic errors, blocking paths or clarification',async()=>{
 assert.equal((await run({}, {}, {evaluate:()=>['Wrong required radius']})).status,'INVALID');
 assert.equal((await run({acceptedPaths:[],objections:[{path,reason:'Wrong requested value',severity:'blocking'}]})).status,'PARTIAL_CONSENSUS');
 const contradictory={...context,brief:'Radius must be 13px. Radius must be 15px.'};
 const clarificationRequests=[{reason:'Different exact values.',question:'Which value applies?',requirements:[{source:'brief',quote:'Radius must be 13px.'},{source:'brief',quote:'Radius must be 15px.'}]}];
 assert.equal((await run({clarificationRequests},{},{context:contradictory})).status,'NEEDS_CLARIFICATION');
});

test('mutation rejects an earlier deferred review and missing later deferral keeps the issue blocking',async()=>{
 const p={...proposal('fable'),reviewScope:scope},c=await agent('astra').critiqueProposal(p);
 await assert.rejects(reviewIsComplete(c,{...p,changes:[{path,value:'15px'}]},'astra'),/hash/);
 const make=role=>{let reviews=0;return {...agent(role),critiqueProposal:async p=>{const c=await agent(role).critiqueProposal(p);return ++reviews===1?{...c,acceptedPaths:[],objections:[{path,reason:'Repair',severity:'blocking'}]}:{...c,deferredIssues:[]};}};};
 const r=await runConsensus({context,astra:make('astra'),fable:make('fable'),maxRounds:2});
 assert.equal(r.status,'PARTIAL_CONSENSUS');assert.deepEqual(r.reviewReadiness.deferredIssues,[]);
});

test('provider normalization retains deferrals, and MCP status retains evidence without release',async()=>{
 const make=role=>new ConfigurableAgent(role,{provider:'fixture',model:'fixture'},async req=>req.task==='critique'?{acceptedPaths:[path],objections:[],deferredIssues:[deferred]}:proposal(role));
 const service=new StyleService(await loadBundle()),r=await service.generateCandidateFromBrief({...context,astra:make('astra'),fable:make('fable'),maxRounds:1},'a','a');
 assert.equal(r.status,'CONSENSUS');assert.equal(service.getConsensusStatus(r.candidateHash,'a','a').reviewReadiness.deferredIssues.length,2);
 for(const role of ['astra','fable'])service.approveCandidate(r.candidateHash,role,'a','a');
 assert.throws(()=>service.publishRelease(r.candidateHash,true,'a','a','human','human'),/Pending/);
 await service.startConsensusRound(r.initial[0].id,r.initial[1].id,'a','a');
 assert.equal(service.getConsensusStatus(r.candidateHash,'a','a').reviewReadiness.deferredIssues.length,2);
 const status=service.getConsensusStatus(r.candidateHash,'a','a');status.reviewReadiness.deferredIssues.length=0;
 assert.equal(service.getConsensusStatus(r.candidateHash,'a','a').reviewReadiness.deferredIssues.length,2);
});

const receipt=(r,answer)=>({status:'completed',call_id:r.callId,host_configured_model:r.model,answer:JSON.stringify(answer),usage:{input_tokens:100,cached_tokens:0,output_tokens:10},estimated_credits:0.1,cost_basis:'token_rate_estimate',budget:{over_budget:false,reserved_credits:0},activity:{completed_items:{agentMessage:1}}});
test('governed structured review exposes and parses deferred verdict without marking resolved',async()=>{
 const invoke=createGovernedHostInvoker({dispatch:async r=>{
  if(r.task!=='critique')return receipt(r,proposal(r.role));
  assert.match(JSON.stringify(r.format),/deferred/);assert.match(r.prompt,/checkId/);
  return receipt(r,{reviews:{[path]:{verdict:'accept',reason:'Correct requested value.'}},issueReviews:{'0':{verdict:'deferred',checkId:'focus',reason:deferred.reason}}});
 }});
 const make=id=>new ConfigurableAgent(id,{provider:'governed-host',model:'fixture'},invoke);
 const r=await runConsensus({context,astra:make('astra'),fable:make('fable'),maxRounds:1});assert.equal(r.status,'CONSENSUS');assert.equal(r.reviewReadiness.deferredIssues.length,2);
});

test('invalid structured deferral stops queued host calls before another dispatch',async()=>{
 for(const verdict of [{verdict:'deferred',reason:'Pending'},{verdict:'deferred',checkId:'invented',reason:'Pending'},{verdict:'resolved',checkId:'focus',reason:'Settled'},{verdict:'deferred',checkId:'focus',reason:'Pending',status:'verified'}]){
  let calls=0;
  const invoke=createGovernedHostInvoker({dispatch:async r=>{calls++;return receipt(r,{reviews:{[path]:{verdict:'accept',reason:'Correct.'}},issueReviews:{'0':verdict}});}});
  const p={...proposal('p'),reviewScope:scope};
  const results=await Promise.allSettled(['astra','fable'].map(id=>new ConfigurableAgent(id,{provider:'governed-host',model:'fixture'},invoke).critiqueProposal(p,context)));
  assert.ok(results.every(r=>r.status==='rejected'));assert.equal(calls,1);
 }
});

test('real canonical contrast failure cannot be deferred into an MCP candidate',async()=>{
 const focusPath='tokens.semantic.focus.ring.$value';
 const make=id=>new ConfigurableAgent(id,{provider:'fixture',model:'fixture'},async r=>r.task==='critique'?{acceptedPaths:[focusPath],objections:[],deferredIssues:[deferred]}:{...proposal(id),changes:[{path:focusPath,value:'{color.white}'}]});
 const service=new StyleService(await loadBundle());
 const r=await service.generateCandidateFromBrief({...context,astra:make('astra'),fable:make('fable'),maxRounds:1},'a','a');
 assert.equal(r.status,'INVALID');assert.ok(r.evaluationErrors.some(e=>/contrast/i.test(e)));
 assert.throws(()=>service.getConsensusStatus(r.candidateHash,'a','a'),/Unknown/);
});

test('deferrals remain open through repair and are freshly bound to the changed hash',async()=>{
 const observed=[];
 const make=role=>({...agent(role),critiqueProposal:async p=>{observed.push(p);const c=await agent(role).critiqueProposal(p);return p.changes[0].value==='13px'?{...c,acceptedPaths:[],objections:[{path,reason:'Needs 15px',severity:'blocking'}]}:c;},reviseProposal:async p=>({...p,changes:[{path,value:'15px'}],unresolved:[]})});
 const r=await runConsensus({context,astra:make('astra'),fable:make('fable'),maxRounds:2});
 assert.equal(r.status,'CONSENSUS');assert.equal(r.rounds,2);
 assert.ok(observed.every(p=>p.unresolved.includes(issue)));
 assert.notEqual(r.critiques[0].candidateHash,r.candidateHash);
 assert.ok(r.reviewReadiness.deferredIssues.every(d=>d.candidateHash===r.candidateHash));
});

test('clarification persistence retains deferral evidence without clearing its hold',async()=>{
 let saved={heldHashes:[],contexts:[]};
 const storage={load:()=>globalThis.structuredClone(saved),save:s=>{saved=globalThis.structuredClone(s);},assertHealthy:()=>{}};
 const brief='Use 13px. Use 15px.';
 const clarificationRequests=[{reason:'Incompatible values.',question:'Which value?',requirements:[{source:'brief',quote:'Use 13px.'},{source:'brief',quote:'Use 15px.'}]}];
 const bundle=await loadBundle(),service=new StyleService(bundle,new Map(),{clarificationStore:storage});
 const input={...context,brief,astra:agent('astra',{clarificationRequests}),fable:agent('fable'),maxRounds:1};
 const r=await service.generateCandidateFromBrief(input,'a','a');assert.equal(r.status,'NEEDS_CLARIFICATION');assert.equal(r.reviewReadiness.deferredIssues.length,2);
 const restarted=new StyleService(bundle,new Map(),{clarificationStore:storage}),again=await restarted.generateCandidateFromBrief(input,'a','a');
 assert.equal(again.reused,true);assert.deepEqual(again.reviewReadiness,r.reviewReadiness);
 assert.throws(()=>restarted.approveCandidate(r.candidateHash,'astra','a','a'),/clarification/);
});
