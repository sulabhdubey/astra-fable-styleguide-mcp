import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../dist/packages/consensus-engine/src/index.js';
import { ConfigurableAgent, createGovernedHostInvoker } from '../dist/packages/provider-adapters/src/index.js';
import { StyleService } from '../dist/apps/mcp-server/src/service.js';
import { loadBundle } from './helpers.mjs';

const scope={stage:'specification',pendingChecks:[
  {id:'focus-adjacency',requirement:'Focus indicators contrast at least 3:1 against every adjacent rendered surface.',evidenceRequired:'Browser measurements of button and input focus states on each surface.'},
  {id:'border-state-distinction',requirement:'Default and focus states remain visually distinguishable.',evidenceRequired:'Rendered review of affected controls, cards and navigation.'}
]};
const context={brief:'Remap brand tokens while preserving focus rules.',criteria:['Preserve accessibility requirements.'],baseVersion:'0.6.0',reviewScope:scope};
const proposal=role=>({id:role,author:role,baseVersion:'0.6.0',summary:'Token remap',changes:[{path:'tokens.radius.md.$value',value:'14px'}],tradeoffs:[],unresolved:[]});
const agent=(role,options={})=>new ConfigurableAgent(role,{provider:'fixture',model:'fixture'},async request=>{
  if(request.task==='critique'){
    const p=request.payload.proposal;
    options.observe?.(p,request.payload.context);
    return {acceptedPaths:p.changes.map(c=>c.path),objections:[],resolvedIssues:[],...options.critique};
  }
  return {...proposal(role),...options.proposal,...(request.task==='revision'?{unresolved:[]}:{} )};
});

test('specification agreement retains caller-defined browser obligations as pending',async()=>{
  const seen=[];
  const run=await engine.runConsensus({context,astra:agent('astra',{observe:p=>seen.push(p)}),fable:agent('fable'),maxRounds:1});
  assert.equal(run.status,'CONSENSUS');
  assert.deepEqual(run.candidate.reviewScope,scope);
  assert.deepEqual(seen[0].reviewScope,scope);
  assert.equal(run.reviewReadiness.renderedVerified,false);
  assert.equal(run.reviewReadiness.pendingChecks.length,2);
  assert.ok(run.reviewReadiness.pendingChecks.every(c=>c.status==='pending'));
  assert.equal(run.reviewReadiness.candidateHash,run.candidateHash);
});

test('scope cannot silently reclassify or drop an existing unresolved issue',async()=>{
  const unresolved=['Focus contrast on non-primary adjacent surfaces remains unverified.'];
  const run=await engine.runConsensus({context,astra:agent('astra',{proposal:{unresolved}}),fable:agent('fable'),maxRounds:2});
  assert.equal(run.status,'PARTIAL_CONSENSUS');
  assert.deepEqual(run.candidate.reviewScope,scope);
});

test('deterministic defects and explicit blocking reviews still prevent scoped consensus',async()=>{
  const run=await engine.runConsensus({context,astra:agent('astra'),fable:agent('fable'),maxRounds:1,evaluate:()=>['Invalid focus token alias']});
  assert.equal(run.status,'INVALID');
  const blocked=await engine.runConsensus({context,astra:agent('astra',{critique:{acceptedPaths:[],objections:[{path:'tokens.radius.md.$value',reason:'Wrong requested value',severity:'blocking'}]}}),fable:agent('fable'),maxRounds:1});
  assert.equal(blocked.status,'PARTIAL_CONSENSUS');
});

test('scope and pending evidence requirements participate in the exact candidate hash',async()=>{
  const run=await engine.runConsensus({context,astra:agent('astra'),fable:agent('fable'),maxRounds:1});
  const changed=globalThis.structuredClone(run.candidate);
  changed.reviewScope.pendingChecks.pop();
  assert.equal(await engine.approvalsStillValid(changed,[engine.approve('astra',run.candidateHash)]),false);
  assert.notEqual(await engine.sha256({baseVersion:run.candidate.baseVersion,changes:run.candidate.changes}),run.candidateHash);
});

test('scope survives conflict repair and stale unscoped review hashes are rejected',async()=>{
  const seen=[];
  const make=role=>new ConfigurableAgent(role,{provider:'fixture',model:'fixture'},async request=>{
    if(request.task==='critique'){
      const p=request.payload.proposal;seen.push(p.reviewScope);
      return {acceptedPaths:p.changes.map(c=>c.path),objections:[]};
    }
    return {...proposal(role),changes:[{path:'tokens.radius.md.$value',value:request.task==='revision'?'14px':role==='astra'?'10px':'12px'}]};
  });
  const run=await engine.runConsensus({context,astra:make('astra'),fable:make('fable'),maxRounds:2});
  assert.equal(run.status,'CONSENSUS');assert.equal(run.rounds,2);
  assert.ok(seen.every(s=>JSON.stringify(s)===JSON.stringify(scope)));
  const p={...proposal('astra'),reviewScope:scope};
  const stale={reviewer:'fable',proposalId:p.id,candidateHash:await engine.sha256({baseVersion:p.baseVersion,changes:p.changes}),acceptedPaths:p.changes.map(c=>c.path),objections:[]};
  await assert.rejects(engine.reviewIsComplete(stale,p,'fable'),/hash/);
  await assert.rejects(make('astra').reviseProposal(p,stale,context,1),/Stale/);
  assert.throws(()=>engine.mergeProposals(p,proposal('fable')),/scope/);
});

test('clarification remains terminal and retains scope across durable service restore',async()=>{
  let state={heldHashes:[],contexts:[]};
  const store={load:()=>globalThis.structuredClone(state),save:s=>{state=globalThis.structuredClone(s);},assertHealthy:()=>{}};
  const brief='Use 10px radius. Use 14px radius.';
  const clarificationRequests=[{reason:'Two exact values for one token.',question:'Which radius is required?',requirements:[{source:'brief',quote:'Use 10px radius.'},{source:'brief',quote:'Use 14px radius.'}]}];
  const input={...context,brief,astra:agent('astra',{critique:{clarificationRequests}}),fable:agent('fable'),maxRounds:2};
  const bundle=await loadBundle();
  const service=new StyleService(bundle,new Map(),{clarificationStore:store});
  const run=await service.generateCandidateFromBrief(input,'admin','admin');
  assert.equal(run.status,'NEEDS_CLARIFICATION');assert.equal(run.rounds,1);
  assert.deepEqual(run.clarification.requests[0].reviewedCandidate.reviewScope,scope);
  const restarted=new StyleService(bundle,new Map(),{clarificationStore:store});
  const fail={id:'astra',generateProposal:async()=>{throw Error('Must reuse hold');}};
  const reused=await restarted.generateCandidateFromBrief({...input,astra:fail},'admin','admin');
  assert.equal(reused.reused,true);assert.deepEqual(reused.reviewReadiness,run.reviewReadiness);
});

test('governed host sends the same scope at every stage and stops queued scope tampering',async()=>{
  const seen=[];
  const receipt=(r,answer)=>({status:'completed',call_id:r.callId,host_configured_model:r.model,answer:JSON.stringify(answer),usage:{input_tokens:10,cached_tokens:0,output_tokens:10},estimated_credits:0.1,cost_basis:'token_rate_estimate',budget:{over_budget:false,reserved_credits:0},activity:{completed_items:{agentMessage:1}}});
  const invoke=createGovernedHostInvoker({dispatch:async r=>{
    seen.push(r);assert.match(r.prompt,/REVIEW SCOPE: specification only/);assert.match(r.prompt,/focus-adjacency/);assert.match(r.prompt,/Never claim they ran/);
    return receipt(r,r.task==='critique'?{reviews:{'tokens.radius.md.$value':{requestedValue:'14px',observedValue:'14px',reason:'Matches specification.',verdict:'accept'}}}:proposal(r.role));
  }});
  const make=id=>new ConfigurableAgent(id,{provider:'governed-host',model:'fixture'},invoke);
  const run=await engine.runConsensus({context,astra:make('astra'),fable:make('fable'),maxRounds:1});
  assert.equal(run.status,'CONSENSUS');assert.equal(seen.length,4);
  let calls=0;
  const invalid=createGovernedHostInvoker({dispatch:async r=>{calls++;return receipt(r,{...proposal(r.role),reviewScope:{stage:'specification',pendingChecks:[]}});}});
  const results=await Promise.allSettled(['astra','fable'].map(id=>new ConfigurableAgent(id,{provider:'governed-host',model:'fixture'},invalid).generateProposal(context)));
  assert.ok(results.every(r=>r.status==='rejected'));assert.equal(calls,1);
});

test('invalid scope is rejected before any model calls, and models cannot replace scope',async()=>{
  let calls=0;
  const unused={id:'unused',generateProposal:async()=>{calls++;return proposal('unused');}};
  await assert.rejects(engine.runConsensus({context:{...context,reviewScope:{...scope,pendingChecks:[{...scope.pendingChecks[0],status:'verified'}]}},astra:unused,fable:{...unused,id:'other'}}),/scope|pending|check/i);
  assert.equal(calls,0);
  await assert.rejects(agent('astra',{proposal:{reviewScope:{stage:'specification',pendingChecks:[]}}}).generateProposal(context),/scope/i);
});

test('MCP status preserves scope and pending checks; approvals cannot publish unverified evidence',async()=>{
  const service=new StyleService(await loadBundle());
  const run=await service.generateCandidateFromBrief({...context,astra:agent('astra'),fable:agent('fable'),maxRounds:1},'admin','admin');
  assert.equal(run.status,'CONSENSUS');
  const status=service.getConsensusStatus(run.candidateHash,'admin','admin');
  assert.equal(status.reviewReadiness.renderedVerified,false);
  assert.equal(status.reviewReadiness.pendingChecks.length,2);
  for(const role of ['astra','fable'])service.approveCandidate(run.candidateHash,role,'admin','admin');
  assert.throws(()=>service.publishRelease(run.candidateHash,true,'admin','admin','human','human'),/pending/i);
  const manual=await service.startConsensusRound(run.initial[0].id,run.initial[1].id,'admin','admin');
  assert.equal(manual.candidateHash,run.candidateHash);
  assert.throws(()=>service.publishRelease(manual.candidateHash,true,'admin','admin','human','human'),/pending/i);
});
