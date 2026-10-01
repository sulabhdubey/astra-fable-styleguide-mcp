import test from 'node:test';
import assert from 'node:assert/strict';
import {bindReviewScope,validateReviewScope,runConsensus,sha256,candidateFromProposal,reviewIsComplete} from '../dist/packages/consensus-engine/src/index.js';
import {ConfigurableAgent,createGovernedHostInvoker} from '../dist/packages/provider-adapters/src/index.js';
import {StyleService} from '../dist/apps/mcp-server/src/service.js';
import {loadBundle,loadJson} from './helpers.mjs';
const text='Rendered dimensions remain unmeasured.';
const scope={stage:'specification',pendingChecks:[{id:'measure',requirement:'Usable targets',evidenceRequired:'Browser measurements'}],issues:[{id:'target',text}]};
const currentVersion=(await loadJson('spec/manifest.json')).version;
const context={brief:'Change radius to 11px.',criteria:[],baseVersion:currentVersion,reviewScope:scope};
const path='tokens.radius.md.$value';
const proposal=id=>({id,author:id,baseVersion:currentVersion,summary:'Radius',changes:[{path,value:'11px'}],tradeoffs:[],unresolved:[],issueNotes:[{issueId:'target',note:'Pending actual browser measurement.'}]});
const make=id=>({id,generateProposal:async()=>proposal(id),critiqueProposal:async p=>({reviewer:id,proposalId:p.id,candidateHash:await sha256(candidateFromProposal(p)),acceptedPaths:[path],objections:[],deferredIssues:[{issue:text,issueId:'target',checkId:'measure',reason:'Evidence remains pending.'}]}),reviseProposal:async()=>proposal(id)});

test('caller identity survives model omission and duplicate notes without merging distinct concerns',()=>{
 const p=bindReviewScope({...proposal('a'),unresolved:['Different concern','Different concern'],issueNotes:[...proposal('a').issueNotes,...proposal('a').issueNotes,{issueId:'target',note:'A second explanation.'}]},context);
 assert.deepEqual(p.unresolved,[text,'Different concern']);assert.equal(p.issueNotes.length,2);
 assert.deepEqual(p.reviewScope.issues,scope.issues);
});
test('reject invalid caller identity, ambiguous identical texts and unknown notes',()=>{
 for(const issues of [[{id:'',text}],[{id:'x',text:''}],[{id:'x',text},{id:'x',text:'Other'}],[{id:'x',text},{id:'y',text}],[{id:'x',text,status:'resolved'}]])assert.throws(()=>validateReviewScope({...scope,issues}));
 for(const issueNotes of [[{issueId:'unknown',note:'Explain'}],[{issueId:'target',note:''}],[{issueId:'target',note:'Explain',resolved:true}]])assert.throws(()=>bindReviewScope({...proposal('a'),issueNotes},context));
});
test('both roles defer stable identity; notes stay separate and pending evidence stays open',async()=>{
 const r=await runConsensus({context,astra:make('astra'),fable:make('fable'),maxRounds:1});
 assert.equal(r.status,'CONSENSUS');assert.equal(r.issueNotes.length,1);
 assert.ok(r.initial.every(p=>p.unresolved.length===1&&p.unresolved[0]===text));
 assert.ok(r.reviewReadiness.deferredIssues.every(d=>d.issueId==='target'&&d.status==='open'));
 const changed={...r.candidate,reviewScope:{...scope,issues:[{id:'target',text:'Changed requirement'}]}};
 assert.notEqual(await sha256(changed),r.candidateHash);
 await assert.rejects(reviewIsComplete(r.critiques[0],{...r.initial[0],id:r.critiques[0].proposalId,...changed,unresolved:['Changed requirement']},'astra'),/hash/);
});
test('wrong supplied issue identity fails closed',async()=>{
 const a=make('astra'),orig=a.critiqueProposal;
 a.critiqueProposal=async p=>{const c=await orig(p);c.deferredIssues[0].issueId='other';return c;};
 await assert.rejects(runConsensus({context,astra:a,fable:make('fable'),maxRounds:1}),/issue/i);
});
const receipt=(r,a)=>({status:'completed',call_id:r.callId,host_configured_model:r.model,answer:JSON.stringify(a),usage:{input_tokens:100,cached_tokens:0,output_tokens:10},estimated_credits:0.1,cost_basis:'token_rate_estimate',budget:{over_budget:false,reserved_credits:0},activity:{completed_items:{agentMessage:1}}});
test('governed lifecycle uses stable review keys and accepts explanatory note variants',async()=>{
 const invoke=createGovernedHostInvoker({dispatch:async r=>{
  if(r.task!=='critique'){assert.ok(r.format.properties.issueNotes);return receipt(r,{...proposal(r.role),issueNotes:[{issueId:'target',note:r.role+' explanation'}]});}
  assert.deepEqual(r.format.properties.issueReviews.required,['issue:target']);
  return receipt(r,{reviews:{[path]:{verdict:'accept',reason:'Requested value'}},issueReviews:{'issue:target':{verdict:'deferred',checkId:'measure',reason:'Browser measurement pending'}}});
 }});
 const agent=id=>new ConfigurableAgent(id,{provider:'governed-host',model:'fixture'},invoke);
 const r=await runConsensus({context,astra:agent('astra'),fable:agent('fable'),maxRounds:1});
 assert.equal(r.status,'CONSENSUS');assert.equal(r.issueNotes.length,2);assert.equal(r.initial[0].unresolved.length,1);
});
test('direct review rejects omitted caller concerns before invoking the provider',async()=>{
 const p={...proposal('a'),reviewScope:scope};let called=false;
 const agent=new ConfigurableAgent('astra',{provider:'fixture',model:'fixture'},async()=>{called=true;return {acceptedPaths:[path],objections:[]};});
 await assert.rejects(agent.critiqueProposal(p,context),/caller issue/i);assert.equal(called,false);
 const c={reviewer:'astra',proposalId:p.id,candidateHash:await sha256(candidateFromProposal(p)),acceptedPaths:[path],objections:[]};
 await assert.rejects(reviewIsComplete(c,p,'astra'),/caller issue/i);
});
test('a similarly worded additional concern is never automatically swallowed by a note',async()=>{
 const distinct='Rendered dimensions remain unmeasured in the nested scroll panel.';
 const a=make('astra');a.generateProposal=async()=>({...proposal('astra'),unresolved:[distinct]});
 const r=await runConsensus({context,astra:a,fable:make('fable'),maxRounds:1});
 assert.equal(r.status,'PARTIAL_CONSENSUS');assert.ok(r.initial[0].unresolved.includes(distinct));
});
test('repair retains caller identity and distinct explanations, without accumulating exact duplicates',async()=>{
 const agent=id=>({...make(id),critiqueProposal:async p=>({...await make(id).critiqueProposal(p),...(p.changes[0].value==='11px'?{acceptedPaths:[],objections:[{path,reason:'Use 15px',severity:'blocking'}]}:{})}),reviseProposal:async()=>({...proposal(id),changes:[{path,value:'15px'}],issueNotes:[...proposal(id).issueNotes,{issueId:'target',note:id+' additional detail'}]})});
 const r=await runConsensus({context,astra:agent('astra'),fable:agent('fable'),maxRounds:2});
 assert.equal(r.status,'CONSENSUS');assert.equal(r.rounds,2);assert.equal(r.issueNotes.length,3);
 assert.ok(r.reviewReadiness.deferredIssues.every(d=>d.issueId==='target'&&d.candidateHash===r.candidateHash));
});
test('note limit counts unique accumulated notes across rounds rather than duplicate inputs',async()=>{
 const notes=Array.from({length:60},(_,i)=>({issueId:'target',note:'Observation '+i}));
 const agent=id=>({...make(id),generateProposal:async()=>({...proposal(id),issueNotes:notes}),critiqueProposal:async p=>({...await make(id).critiqueProposal(p),...(p.changes[0].value==='11px'?{acceptedPaths:[],objections:[{path,reason:'Use 15px',severity:'blocking'}]}:{})}),reviseProposal:async()=>({...proposal(id),changes:[{path,value:'15px'}],issueNotes:notes})});
 const r=await runConsensus({context,astra:agent('astra'),fable:agent('fable'),maxRounds:2});
 assert.equal(r.status,'CONSENSUS');assert.equal(r.issueNotes.length,60);
});
test('invalid proposal notes stop the serialized provider queue',async()=>{
 let calls=0;const invoke=createGovernedHostInvoker({dispatch:async r=>{calls++;return receipt(r,{...proposal(r.role),issueNotes:[{issueId:'invented',note:'Claim'}]});}});
 const all=await Promise.allSettled(['astra','fable'].map(id=>new ConfigurableAgent(id,{provider:'governed-host',model:'fixture'},invoke).generateProposal(context)));
 assert.ok(all.every(r=>r.status==='rejected'));assert.equal(calls,1);
});
test('stable review ID cannot be substituted with its legacy index',async()=>{
 const invoke=createGovernedHostInvoker({dispatch:async r=>receipt(r,{reviews:{[path]:{verdict:'accept',reason:'Correct'}},issueReviews:{'0':{verdict:'deferred',checkId:'measure',reason:'Pending'}}})});
 const p=bindReviewScope(proposal('fable'),context);
 await assert.rejects(new ConfigurableAgent('astra',{provider:'governed-host',model:'fixture'},invoke).critiqueProposal(p,context),/omitted unresolved/);
});
test('MCP status and restart clarification evidence retain caller IDs with release denial',async()=>{
 let saved={heldHashes:[],contexts:[]};const storage={load:()=>globalThis.structuredClone(saved),save:s=>{saved=globalThis.structuredClone(s);},assertHealthy:()=>{}};
 const bundle=await loadBundle(),service=new StyleService(bundle,new Map(),{clarificationStore:storage});
 const input={...context,astra:make('astra'),fable:make('fable'),maxRounds:1};
 const r=await service.generateCandidateFromBrief(input,'a','a');assert.equal(r.status,'CONSENSUS');
 for(const id of ['astra','fable'])service.approveCandidate(r.candidateHash,id,'a','a');
 assert.throws(()=>service.publishRelease(r.candidateHash,true,'a','a','h','h'),/Pending/);
 assert.ok(service.getConsensusStatus(r.candidateHash,'a','a').reviewReadiness.deferredIssues.every(d=>d.issueId==='target'));
 const bad={...input,brief:'Use 11px. Use 15px.'};
 bad.astra={...make('astra'),critiqueProposal:async p=>({...await make('astra').critiqueProposal(p),clarificationRequests:[{reason:'Conflicting values',question:'Which value?',requirements:[{source:'brief',quote:'Use 11px.'},{source:'brief',quote:'Use 15px.'}]}]})};
 const held=await service.generateCandidateFromBrief(bad,'a','a');assert.equal(held.status,'NEEDS_CLARIFICATION');
 const again=await new StyleService(bundle,new Map(),{clarificationStore:storage}).generateCandidateFromBrief(bad,'a','a');
 assert.equal(again.reused,true);assert.deepEqual(again.reviewReadiness,held.reviewReadiness);assert.deepEqual(again.issueNotes,held.issueNotes);
});
test('manual proposal creation validates note identity too',async()=>{
 const service=new StyleService(await loadBundle());
 const p={...proposal('astra'),reviewScope:scope,issueNotes:[{issueId:'invented',note:'Explanation'}]};
 assert.throws(()=>service.createProposal(p.id,p,'a','a'),/issue/i);
 const good={...proposal('astra'),reviewScope:scope};
 assert.equal(service.createProposal(good.id,good,'a','a').status,'open');
});
