import test from 'node:test';
import assert from 'node:assert/strict';
import {runConsensus,sha256} from '../dist/packages/consensus-engine/src/index.js';
import {ConfigurableAgent,createGovernedHostInvoker} from '../dist/packages/provider-adapters/src/index.js';
import {StyleService} from '../dist/apps/mcp-server/src/service.js';
import {loadBundle,loadJson} from './helpers.mjs';
import {compareDesignSuite} from '../scripts/compare-local-design.mjs';
import {ClarificationStore} from '../dist/apps/mcp-server/src/clarification-store.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const path='tokens.duration.normal.$value';
const currentVersion=(await loadJson('spec/manifest.json')).version;
const context={brief:'Requirement A requires 210ms. Requirement B requires 230ms.',criteria:['Both requirements are mandatory.'],baseVersion:currentVersion};
const request={reason:'The same duration cannot have two different values simultaneously.',question:'Which duration should apply: 210ms or 230ms?',requirements:[{source:'brief',quote:'Requirement A requires 210ms.'},{source:'brief',quote:'Requirement B requires 230ms.'}]};
const candidate=p=>({baseVersion:p.baseVersion,changes:p.changes});
const proposal=(role,value='210ms')=>({id:`P-${role}`,author:role,baseVersion:context.baseVersion,summary:'Tentative duration',changes:[{path,value}],tradeoffs:[],unresolved:[]});
const review=async(role,p,requests)=>({reviewer:role,proposalId:p.id,candidateHash:await sha256(candidate(p)),objections:[],acceptedPaths:[path],...(requests===undefined?{}:{clarificationRequests:requests})});
function makeAgent(role,calls,{value='210ms',requests,override={}}={}){
  return {id:role,generateProposal:async ctx=>{calls.push('proposal');assert.equal(ctx.reconciliation,undefined);return proposal(role,value);},critiqueProposal:async p=>{calls.push('review');return {...await review(role,p,requests),...override};},reviseProposal:async()=>{calls.push('revision');throw new Error('Clarification must stop before revision');}};
}

test('durable clarification state restores holds and permits only fresh clarified consensus',async()=>{
  let state={heldHashes:[],contexts:[]},writes=0;
  const store={load:()=>globalThis.structuredClone(state),save:next=>{state=globalThis.structuredClone(next);writes++;},assertHealthy:()=>{}};
  const bundle=await loadBundle(), options={clarificationStore:store};
  const first=new StyleService(bundle,new Map(),options);
  const input={...context,astra:makeAgent('astra',[],{requests:[request]}),fable:makeAgent('fable',[])};
  const held=await first.generateCandidateFromBrief(input,'admin','admin');
  assert.equal(writes,1,'hold must be persisted before returning');
  const restarted=new StyleService(bundle,new Map(),options),calls=[];
  const reused=await restarted.generateCandidateFromBrief({...input,astra:makeAgent('astra',calls),fable:makeAgent('fable',calls)},'admin','admin');
  assert.equal(reused.reused,true);assert.equal(calls.length,0);
  assert.throws(()=>restarted.approveCandidate(held.candidateHash,'astra','admin','admin'),/clarification/);
  assert.throws(()=>restarted.publishRelease(held.candidateHash,true,'admin','admin','human','human'),/clarification/);
  for(const role of ['astra','fable'])restarted.createProposal('fresh-'+role,{...proposal(role),id:'fresh-'+role},'admin','admin');
  assert.equal((await restarted.startConsensusRound('fresh-astra','fresh-fable','admin','admin')).status,'needs_clarification');
  const clarified=await restarted.generateCandidateFromBrief({...input,brief:'The duration must be 210ms. The earlier 230ms requirement is withdrawn.',astra:makeAgent('astra',calls),fable:makeAgent('fable',calls)},'admin','admin');
  assert.equal(clarified.status,'CONSENSUS');assert.equal(calls.length,4);
  assert.deepEqual(restarted.getConsensusStatus(clarified.candidateHash,'admin','admin').approvals,[]);
  assert.equal(state.heldHashes.includes(clarified.candidateHash),false);
});

test('failed persistence blocks later governance actions and provider dispatch',async()=>{
  const store={load:()=>({heldHashes:[],contexts:[]}),save:()=>{throw Error('disk full');},assertHealthy:()=>{}};
  const service=new StyleService(await loadBundle(),new Map(),{clarificationStore:store});
  const input={...context,astra:makeAgent('astra',[],{requests:[request]}),fable:makeAgent('fable',[])};
  await assert.rejects(service.generateCandidateFromBrief(input,'admin','admin'),/disk full/);
  const calls=[];
  await assert.rejects(service.generateCandidateFromBrief({...input,brief:'New brief',astra:makeAgent('astra',calls),fable:makeAgent('fable',calls)},'admin','admin'),/storage|persistence/i);
  assert.equal(calls.length,0);
  assert.throws(()=>service.createProposal('x',{...proposal('astra'),id:'x'},'admin','admin'),/storage|persistence/i);
});

test('real disk restart retains cached evidence, blocks publication and recovers with fresh approvals',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'hold-restart-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'holds.jsonl');ClarificationStore.initialize(file);
  const bundle=await loadBundle(),first=new StyleService(bundle,new Map(),{clarificationStore:new ClarificationStore(file)});
  const input={...context,astra:makeAgent('astra',[],{requests:[request]}),fable:makeAgent('fable',[])};
  const held=await first.generateCandidateFromBrief(input,'admin','admin');
  const restored=new StyleService(bundle,new Map(),{clarificationStore:new ClarificationStore(file)});
  assert.deepEqual((await restored.generateCandidateFromBrief(input,'admin','admin')).clarification,held.clarification);
  assert.throws(()=>restored.publishRelease(held.candidateHash,true,'admin','admin','human','human'),/clarification/);
  const run=await restored.generateCandidateFromBrief({...input,brief:'Use 210ms. The 230ms rule no longer applies.',astra:makeAgent('astra',[]),fable:makeAgent('fable',[])},'admin','admin');
  assert.equal(run.status,'CONSENSUS');
  assert.throws(()=>restored.publishRelease(run.candidateHash,true,'admin','admin','human','human'),/approvals required/);
  restored.approveCandidate(run.candidateHash,'astra','admin','admin');restored.approveCandidate(run.candidateHash,'fable','admin','admin');
  assert.equal(restored.publishRelease(run.candidateHash,true,'admin','admin','human','human').status,'released');
  assert.equal(new ClarificationStore(file).load().heldHashes.includes(run.candidateHash),false);
});

test('one grounded clarification request stops at the first review, without revision',async()=>{
  const calls=[];
  const run=await runConsensus({astra:makeAgent('astra',calls,{requests:[request]}),fable:makeAgent('fable',calls),context,maxRounds:5});
  assert.equal(run.status,'NEEDS_CLARIFICATION');assert.equal(run.rounds,1);
  assert.deepEqual(calls,['proposal','proposal','review','review']);
  assert.equal(run.clarification.contextHash,await sha256(context));
  assert.equal(run.clarification.requests.length,1);
  const evidence=run.clarification.requests[0];
  assert.equal(evidence.reviewer,'astra');assert.equal(evidence.evidenceKind,'unverified');
  assert.equal(evidence.candidateHash,await sha256(evidence.reviewedCandidate));
  assert.deepEqual(evidence.request,request);
});

test('conflicting candidates retain both exact review hashes and deterministic errors',async()=>{
  const calls=[];
  const run=await runConsensus({astra:makeAgent('astra',calls,{requests:[request]}),fable:makeAgent('fable',calls,{value:'230ms',requests:[request]}),context,maxRounds:1,evaluate:()=>['Unresolved policy conflict']});
  assert.equal(run.status,'NEEDS_CLARIFICATION');assert.equal(run.conflicts.length,1);
  assert.ok(run.evaluationErrors.includes('Unresolved policy conflict'));
  assert.equal(new Set(run.clarification.requests.map(r=>r.candidateHash)).size,2);
  for(const r of run.clarification.requests)assert.equal(r.candidateHash,await sha256(r.reviewedCandidate));
});

test('malformed, invented, duplicate and ungrounded requirements fail closed',async()=>{
  for(const requests of [null,'yes',Array(5).fill(request),[{...request,question:'x'.repeat(501)}],[{...request,question:''}],[{...request,requirements:[request.requirements[0]]}],[{...request,requirements:[request.requirements[0],request.requirements[0]]}],[{...request,requirements:[request.requirements[0],{source:'brief',quote:'Invented requirement'}]}],[{...request,requirements:[request.requirements[0],{source:'unknown',quote:'Requirement B requires 230ms.'}]}]]){
    const calls=[];
    await assert.rejects(runConsensus({astra:makeAgent('astra',calls,{requests}),fable:makeAgent('fable',calls),context}),/clarification/i);
    assert.ok(!calls.includes('revision'));
  }
});

test('stale hash or wrong reviewer cannot turn a clarification into a trusted result',async()=>{
  for(const override of [{candidateHash:'0'.repeat(64)},{reviewer:'fable'},{proposalId:'other'}]){
    const calls=[];
    await assert.rejects(runConsensus({astra:makeAgent('astra',calls,{requests:[request],override}),fable:makeAgent('fable',calls),context}),/review.*(hash|identity)/i);
  }
});

test('clarification can quote criteria and actual deterministic feedback, not invented errors',async()=>{
  const requests=[{...request,requirements:[{source:'criteria',quote:'Both requirements are mandatory.'},{source:'validation',quote:'Focus contrast is below 3:1'}]}];
  const run=()=>runConsensus({astra:makeAgent('astra',[],{requests}),fable:makeAgent('fable',[]),context,maxRounds:1,evaluate:()=>['Focus contrast is below 3:1']});
  assert.equal((await run()).status,'NEEDS_CLARIFICATION');
  await assert.rejects(runConsensus({astra:makeAgent('astra',[],{requests}),fable:makeAgent('fable',[]),context,maxRounds:1}),/clarification/i);
});

test('new clarified run starts independently; old clarification does not grant approval',async()=>{
  const first=await runConsensus({astra:makeAgent('astra',[],{requests:[request]}),fable:makeAgent('fable',[]),context});
  const clarified={...context,brief:'Requirement A requires 210ms. Requirement B is withdrawn.'};
  const calls=[];
  const next=await runConsensus({astra:makeAgent('astra',calls),fable:makeAgent('fable',calls),context:clarified});
  assert.equal(first.status,'NEEDS_CLARIFICATION');assert.equal(next.status,'CONSENSUS');
  assert.equal(calls.length,4);assert.notEqual(first.clarification.contextHash,await sha256(clarified));
  await assert.rejects(runConsensus({astra:makeAgent('astra',[],{requests:[request]}),fable:makeAgent('fable',[]),context:clarified}),/clarification/i);
});

test('governed host schema, parser and service preserve the stop and reject release',async()=>{
  const seen=[];
  const invoke=createGovernedHostInvoker({dispatch:async r=>{
    seen.push(r);const input=JSON.parse(r.prompt.split(' INPUT: ')[1].split('\nRESPONSE_SCHEMA:')[0]);
    let answer;
    if(r.task==='proposal')answer={summary:'Tentative duration',changes:[{path,value:'210ms'}],tradeoffs:[],unresolved:[]};
    else {
      assert.ok(r.format.properties.clarificationRequests,'Structured schema must expose the stop');
      assert.match(r.prompt,/clarificationRequests/);
      answer={reviews:{[path]:{verdict:'accept',reason:'Tentative value is one of the requests'}},clarificationRequests:[request]};
      assert.equal(input.proposal.changes[0].value,'210ms');
    }
    return {status:'completed',call_id:r.callId,host_configured_model:r.model,answer:JSON.stringify(answer),usage:{input_tokens:100,cached_tokens:0,output_tokens:20},estimated_credits:0.1,cost_basis:'token_rate_estimate',budget:{over_budget:false,reserved_credits:0},activity:{completed_items:{agentMessage:1}}};
  }});
  const service=new StyleService(await loadBundle());
  const make=id=>new ConfigurableAgent(id,{provider:'governed-host',model:'mock'},invoke);
  const run=await service.generateCandidateFromBrief({...context,astra:make('astra'),fable:make('fable')},'admin','admin');
  assert.equal(run.status,'NEEDS_CLARIFICATION');assert.equal(seen.length,4);
  assert.equal(service.getGovernanceActivity('admin','admin').recentRuns[0].status,'NEEDS_CLARIFICATION');
  assert.equal(service.getGovernanceActivity('admin','admin').candidates.length,0);
  assert.throws(()=>service.getConsensusStatus(run.candidateHash,'admin','admin'),/Unknown candidate/);
  await assert.rejects(service.startConsensusRound(run.initial[0].id,run.initial[1].id,'admin','admin'),/Unknown proposal|clarification/i);
});

test('held hashes block existing approvals and manual promotion until a fresh clarified consensus',async()=>{
  const service=new StyleService(await loadBundle());
  const input={...context,astra:makeAgent('astra',[]),fable:makeAgent('fable',[])};
  const ready=await service.generateCandidateFromBrief(input,'admin','admin');
  for(const role of ['astra','fable'])service.approveCandidate(ready.candidateHash,role,'admin','admin');
  const held=await service.generateCandidateFromBrief({...input,astra:makeAgent('astra',[],{requests:[request]})},'admin','admin');
  assert.equal(held.candidateHash,ready.candidateHash);
  assert.throws(()=>service.approveCandidate(held.candidateHash,'astra','admin','admin'),/clarification/i);
  assert.throws(()=>service.publishRelease(held.candidateHash,true,'admin','admin','human','human'),/clarification/i);
  assert.equal(service.getConsensusStatus(held.candidateHash,'admin','admin').roleApprovalsComplete,false);
  for(const role of ['astra','fable'])service.createProposal(`manual-${role}`,{...proposal(role),id:`manual-${role}`},'admin','admin');
  const manual=await service.startConsensusRound('manual-astra','manual-fable','admin','admin');
  assert.equal(manual.status,'needs_clarification');
  const fresh=await service.generateCandidateFromBrief({...input,brief:'Set normal duration to 210ms. Prior conflicting requirement is withdrawn.'},'admin','admin');
  assert.equal(fresh.status,'CONSENSUS');
  assert.equal(service.getConsensusStatus(fresh.candidateHash,'admin','admin').roleApprovalsComplete,false);
});

test('single-agent comparison also stops after proposal and clarification review',async()=>{
  const result=await compareDesignSuite({model:'mock',cases:[{id:'conflict',groups:['duration'],brief:context.brief,expectedChanges:[{path,value:'210ms'}]}],maxCases:1,invoke:async r=>{
    if(r.task==='proposal')return proposal(r.role);
    if(r.task==='revision')throw new Error('Unexpected revision');
    return {objections:[],acceptedPaths:[path],clarificationRequests:[request]};
  }});
  assert.equal(result.arms.length,2);
  for(const arm of result.arms){assert.equal(arm.error,null);assert.equal(arm.result.status,'NEEDS_CLARIFICATION');}
  assert.equal(result.arms.find(a=>a.mode==='single').calls.length,2);
  assert.equal(result.arms.find(a=>a.mode==='pair').calls.length,4);
});

test('direct revision cannot dispatch while a clarification request remains',async()=>{
  let calls=0;
  const agent=new ConfigurableAgent('astra',{provider:'mock',model:'mock'},async()=>{calls++;return proposal('astra');});
  const p=proposal('astra');
  await assert.rejects(agent.reviseProposal(p,await review('fable',p,[request]),context,1),/clarification/i);
  assert.equal(calls,0);
});

test('unchanged held context reuses its result without any model call or mutable shared state',async()=>{
  const service=new StyleService(await loadBundle()),calls=[];
  const input={...context,astra:makeAgent('astra',calls,{requests:[request]}),fable:makeAgent('fable',calls)};
  const first=await service.generateCandidateFromBrief(input,'admin','admin');
  first.clarification.requests[0].request.question='Caller changed returned data';
  const again=await service.generateCandidateFromBrief({...input,maxRounds:1},'admin','admin');
  assert.equal(again.reused,true);assert.equal(again.runId,first.runId);assert.equal(calls.length,4);
  assert.equal(again.clarification.requests[0].request.question,request.question);
});

test('an older in-flight consensus cannot clear a newly recorded hold for identical requirements',async()=>{
  const service=new StyleService(await loadBundle());let unblock;
  const wait=new Promise(resolve=>{unblock=resolve;});
  const slow=makeAgent('astra',[]);slow.generateProposal=async()=>{await wait;return proposal('astra');};
  const pending=service.generateCandidateFromBrief({...context,astra:slow,fable:makeAgent('fable',[])},'admin','admin');
  const held=await service.generateCandidateFromBrief({...context,astra:makeAgent('astra',[],{requests:[request]}),fable:makeAgent('fable',[])},'admin','admin');
  unblock();
  const late=await pending;
  assert.equal(held.status,'NEEDS_CLARIFICATION');assert.equal(late.status,'NEEDS_CLARIFICATION');
  assert.equal(service.getGovernanceActivity('admin','admin').candidates.length,0);
});

test('a hold also blocks the other conflicting candidate when only one reviewer asks',async()=>{
  const service=new StyleService(await loadBundle());
  const ready=await service.generateCandidateFromBrief({...context,brief:'Set duration to 230ms.',astra:makeAgent('astra',[],{value:'230ms'}),fable:makeAgent('fable',[],{value:'230ms'})},'admin','admin');
  await service.generateCandidateFromBrief({...context,astra:makeAgent('astra',[]),fable:makeAgent('fable',[],{value:'230ms',requests:[request]})},'admin','admin');
  assert.throws(()=>service.approveCandidate(ready.candidateHash,'astra','admin','admin'),/clarification/i);
});
