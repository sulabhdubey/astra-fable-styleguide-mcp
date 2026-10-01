/* global structuredClone */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as adapters from '../dist/packages/provider-adapters/src/index.js';
import {runConsensus,approvalsStillValid,approve,canRelease} from '../dist/packages/consensus-engine/src/index.js';

const path='tokens.radius.md.$value';
const context={brief:'Set radius to 10px',criteria:['Preserve unrelated tokens'],baseVersion:'0.6.0',referenceSpec:{tokens:{radius:{md:{$type:'dimension',$value:'8px'}}}},proposalContract:{allowedPaths:[path],requiredPaths:[path]}};
const proposal=value=>({summary:'Radius update',changes:[{path,value}],tradeoffs:[],unresolved:[]});
const payloadOf=request=>JSON.parse(request.prompt.split(' INPUT: ')[1].split('\nRESPONSE_SCHEMA:')[0]);
const receipt=(request,answer)=>({status:'completed',call_id:request.callId,host_configured_model:request.model,answer:JSON.stringify(answer),usage:{input_tokens:100,cached_tokens:0,output_tokens:20},estimated_credits:0.1,cost_basis:'token_rate_estimate',budget:{over_budget:false,reserved_credits:0},activity:{completed_items:{agentMessage:1}}});

test('governed host runs independent proposals through repair and exact-hash consensus',async()=>{
  const seen=[];let active=0,maxActive=0;
  const invoke=adapters.createGovernedHostInvoker({maxCalls:8,dispatch:async request=>{
    active++;maxActive=Math.max(active,maxActive);seen.push(request);
    assert.ok(Object.isFrozen(request));assert.ok(Object.isFrozen(request.format));
    const data=payloadOf(request);let answer;
    if(request.task==='proposal'){
      assert.equal(data.proposal,undefined);assert.equal(data.reconciliation,undefined);
      answer=proposal(request.role==='astra'?'8px':'12px');
    }else if(request.task==='revision')answer=proposal('10px');
    else{const observed=data.proposal.changes[0].value;answer={reviews:{[path]:{requestedValue:'10px',observedValue:observed,reason:observed==='10px'?'Matches request':'Needs 10px',verdict:observed==='10px'?'accept':'blocking'}}};}
    await Promise.resolve();active--;return receipt(request,answer);
  }});
  const make=id=>new adapters.ConfigurableAgent(id,{provider:'governed-host',model:'test-model'},invoke);
  const run=await runConsensus({astra:make('astra'),fable:make('fable'),context,maxRounds:2,evaluate:c=>c.changes[0].value==='10px'?[]:['Expected 10px']});
  assert.equal(run.status,'CONSENSUS');assert.equal(run.rounds,2);assert.equal(maxActive,1);
  assert.deepEqual(seen.map(r=>r.task),['proposal','proposal','critique','critique','revision','revision','critique','critique']);
  assert.equal(new Set(seen.map(r=>r.callId)).size,8);
  assert.ok(run.critiques.slice(-2).every(c=>c.candidateHash===run.candidateHash));
  const approvals=['astra','fable'].map(id=>approve(id,run.candidateHash));
  assert.equal(canRelease({candidateHash:run.candidateHash,approvals,humanApproved:false}),false);
  assert.equal(await approvalsStillValid({...run.candidate,changes:[{path,value:'11px'}]},approvals),false);
});

test('unknown usage, wrong identity and unsafe activity block queued host dispatch',async()=>{
  const failures=[
    {status:'unknown_usage'}, {host_configured_model:'other-model'}, {call_id:'another-call'},
    {usage:{input_tokens:100,cached_tokens:101,output_tokens:1}}, {usage:undefined},
    {budget:{over_budget:true,reserved_credits:0}}, {budget:{over_budget:false,reserved_credits:1}},
    {activity:{completed_items:{commandExecution:1}}}, {activity:undefined},
    {answer:'not JSON'}, {estimated_credits:NaN}, {cost_basis:'unknown'}
  ];
  for(const failure of failures){
    let dispatched=0;
    const invoke=adapters.createGovernedHostInvoker({dispatch:async r=>{dispatched++;return {...receipt(r,proposal('10px')),...failure};}});
    const request={role:'astra',model:'test-model',task:'proposal',payload:context};
    const results=await Promise.allSettled([invoke(request),invoke({...request,role:'fable'})]);
    assert.ok(results.every(r=>r.status==='rejected'));assert.equal(dispatched,1);
  }
});

test('host bridge enforces call and response bounds without retries',async()=>{
  let calls=0;
  const invoke=adapters.createGovernedHostInvoker({maxCalls:1,dispatch:async r=>{calls++;return receipt(r,proposal('10px'));}});
  const request={role:'astra',model:'test-model',task:'proposal',payload:context};
  await invoke(request);await assert.rejects(invoke(request),/call budget/);assert.equal(calls,1);
  const oversized=adapters.createGovernedHostInvoker({maxResponseChars:100,dispatch:async r=>receipt(r,{text:'x'.repeat(101)})});
  await assert.rejects(oversized(request),/response character limit/);
  assert.throws(()=>adapters.createGovernedHostInvoker({maxCalls:0,dispatch:async()=>{}}),/call budget/);
});

test('invalid proposal shape or semantics stops queued calls before spending again',async()=>{
  const invalid=[{},proposal({$value:'10px'}),{...proposal('10px'),unresolved:'Unresolved requirement'}, {...proposal('10px'),tradeoffs:{risk:'Needs review'}},{...proposal('10px'),changes:[{path:'tokens.unknown.$value',value:'10px'}]}, {...proposal('10px'),changes:[]}, {...proposal('10px'),changes:[{path,value:'10px'},{path,value:'12px'}]}];
  for(const value of invalid){
    let calls=0;
    const invoke=adapters.createGovernedHostInvoker({dispatch:async r=>{calls++;return receipt(r,value);}});
    const make=id=>new adapters.ConfigurableAgent(id,{provider:'governed-host',model:'test-model'},invoke);
    const results=await Promise.allSettled([make('astra').generateProposal(context),make('fable').generateProposal(context)]);
    assert.ok(results.every(r=>r.status==='rejected'));assert.equal(calls,1,'malformed proposal must stop queued spending');
  }
});

test('completed receipt requires an actual assistant completion event',async()=>{
  for(const completed_items of [{},{reasoning:1,userMessage:1},{agentMessage:0},{agentMessage:-1},{agentMessage:1.5}]){
    const invoke=adapters.createGovernedHostInvoker({dispatch:async r=>({...receipt(r,proposal('10px')),activity:{completed_items}})});
    await assert.rejects(invoke({role:'astra',model:'test-model',task:'proposal',payload:context}),/activity/);
  }
});

test('concurrent queue snapshots inputs and stops all pending requests after transport failure',async()=>{
  const seen=[];
  const invoke=adapters.createGovernedHostInvoker({maxCalls:50,dispatch:async r=>{
    seen.push(r);assert.equal(payloadOf(r).brief,'Set radius to 10px');
    assert.throws(()=>{r.format.type='mutated';},TypeError);
    if(seen.length===4)throw new Error('Transport interrupted; usage unknown');
    return receipt(r,proposal('10px'));
  }});
  const mutable=structuredClone(context);
  const work=Array.from({length:50},()=>invoke({role:'astra',model:'test-model',task:'proposal',payload:mutable}));
  mutable.brief='Mutated after submission';
  const settled=await Promise.allSettled(work);
  assert.equal(seen.length,4);assert.equal(settled.filter(r=>r.status==='fulfilled').length,3);assert.equal(settled.filter(r=>r.status==='rejected').length,47);
});
