import test from 'node:test';
import assert from 'node:assert/strict';
import {ConfigurableAgent,createGovernedHostInvoker} from '../dist/packages/provider-adapters/src/index.js';
import {runConsensus} from '../dist/packages/consensus-engine/src/index.js';

test('review instructions distinguish host-retained concerns and merged notes from generation output',async()=>{
 const path='tokens.radius.md.$value',text='Rendered clipping remains unobserved.';
 const context={brief:'Use 9px radius; put explanations in issueNotes, not unresolved.',criteria:[],baseVersion:'0.6.0',reviewScope:{stage:'specification',pendingChecks:[{id:'clipping',requirement:'Content fits',evidenceRequired:'Rendered observations'}],issues:[{id:'fit',text}]}};
 const invoke=createGovernedHostInvoker({dispatch:async r=>{
  let answer;
  if(r.task==='critique'){
   assert.match(r.prompt,/HOST-NORMALIZED REVIEW INPUT/);
   assert.match(r.prompt,/multiple different notes/);
   assert.doesNotMatch(r.prompt,/GENERATION OUTPUT RULES/);
   answer={reviews:{[path]:{verdict:'accept',reason:'Exact requested value'}},issueReviews:{'issue:fit':{verdict:'deferred',checkId:'clipping',reason:'Rendered evidence pending'}}};
  }else{
   assert.match(r.prompt,/GENERATION OUTPUT RULES/);
   answer={summary:'Fixture',changes:[{path,value:'9px'}],tradeoffs:[],unresolved:[],issueNotes:[{issueId:'fit',note:r.role+' explanation'}]};
  }
  return {status:'completed',call_id:r.callId,host_configured_model:r.model,answer:JSON.stringify(answer),usage:{input_tokens:100,cached_tokens:0,output_tokens:10},estimated_credits:0.1,cost_basis:'token_rate_estimate',budget:{over_budget:false,reserved_credits:0},activity:{completed_items:{agentMessage:1}}};
 }});
 const agent=id=>new ConfigurableAgent(id,{provider:'governed-host',model:'fixture'},invoke);
 const r=await runConsensus({context,astra:agent('astra'),fable:agent('fable'),maxRounds:1});
 assert.equal(r.status,'CONSENSUS');assert.equal(r.issueNotes.length,2);assert.ok(r.initial.every(p=>p.unresolved[0]===text));
 assert.ok(r.reviewReadiness.deferredIssues.every(d=>d.status==='open'));
});
