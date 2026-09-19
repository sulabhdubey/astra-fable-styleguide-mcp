import test from 'node:test';import assert from 'node:assert/strict';
import {runConsensus,mergeProposals,approve,approvalsMatch,approvalsStillValid,canRelease,sha256} from '../dist/packages/consensus-engine/src/index.js';
import {MockAgent} from '../dist/packages/provider-adapters/src/index.js';
const context={brief:'A serious analytics UI',criteria:['accessibility','consistency'],baseVersion:'0.1.0'};
function proposal(id,author,value){return {id,author,baseVersion:'0.1.0',summary:'x',changes:[{path:'tokens.radius',value}],tradeoffs:[],unresolved:[]};}
test('initial proposals are independent and revised proposals are cross-reviewed before consensus',async()=>{const a=new MockAgent('astra',{initial:proposal('A','astra','8px'),convergeTo:{'tokens.radius':'10px'}});const f=new MockAgent('fable',{initial:proposal('F','fable','12px'),convergeTo:{'tokens.radius':'10px'}});const r=await runConsensus({astra:a,fable:f,context});assert.equal(r.status,'CONSENSUS');assert.equal(r.rounds,2);assert.equal(r.critiques.length,4);assert.equal(a.seenInitialContexts.length,1);assert.equal(f.seenInitialContexts.length,1);assert.equal('proposal' in a.seenInitialContexts[0],false);});
test('unresolved blocking critique cannot become consensus',async()=>{
  const agent=role=>({id:role,generateProposal:async()=>proposal(role,role,'10px'),critiqueProposal:async p=>({reviewer:role,proposalId:p.id,objections:[{path:'tokens.radius',reason:'Unresolved concern',severity:'blocking'}],acceptedPaths:[]}),reviseProposal:async p=>p});
  const result=await runConsensus({astra:agent('astra'),fable:agent('fable'),context,maxRounds:2});
  assert.equal(result.status,'PARTIAL_CONSENSUS');
  assert.equal(result.rounds,2);
});
test('a change made after a clear critique needs another cross-review',async()=>{
  const agent=role=>({id:role,generateProposal:async()=>proposal(role,role,'10px'),critiqueProposal:async p=>({reviewer:role,proposalId:p.id,objections:[],acceptedPaths:['tokens.radius']}),reviseProposal:async p=>({...p,changes:[{path:'tokens.radius',value:'12px'}]})});
  const result=await runConsensus({astra:agent('astra'),fable:agent('fable'),context,maxRounds:1});
  assert.equal(result.status,'PARTIAL_CONSENSUS');
});
test('deadlock terminates at configured round limit',async()=>{const a=new MockAgent('astra',{initial:proposal('A','astra','8px')});const f=new MockAgent('fable',{initial:proposal('F','fable','12px')});const r=await runConsensus({astra:a,fable:f,context,maxRounds:2});assert.equal(r.status,'DEADLOCK');assert.equal(r.rounds,2);assert.ok(r.conflicts.length>0);});
test('same hash approvals and human gate are enforced',async()=>{const candidate={baseVersion:'0.1.0',changes:[{path:'a',value:1}]};const hash=await sha256(candidate);const approvals=[approve('astra',hash),approve('fable',hash)];assert.equal(approvalsMatch(hash,approvals),true);assert.equal(canRelease({candidateHash:hash,approvals,humanApproved:false}),false);assert.equal(canRelease({candidateHash:hash,approvals,humanApproved:true}),true);});
test('candidate mutation invalidates approvals',async()=>{const c={baseVersion:'0.1.0',changes:[{path:'a',value:1}]};const h=await sha256(c);const approvals=[approve('astra',h),approve('fable',h)];const mutated={...c,changes:[{path:'a',value:2}]};assert.equal(await approvalsStillValid(mutated,approvals),false);});
test('parent and child change paths conflict across independent roles',()=>{
  const a={...proposal('A','astra',1),changes:[{path:'components.input.accessibility.errorAssociation',value:'Associate the error.'}]};
  const f={...proposal('F','fable',1),changes:[{path:'components.input.accessibility',value:{errorAssociation:'Different guidance'}}]};
  const merged=mergeProposals(a,f);
  assert.equal(merged.conflicts.length,1);
  assert.equal(merged.conflicts[0].path,'components.input.accessibility');
});
test('duplicate paths inside one role do not disappear during merge',()=>{
  const a={...proposal('A','astra',1),changes:[{path:'tokens.radius.md.$value',value:'10px'},{path:'tokens.radius.md.$value',value:'12px'}]};
  const f={...proposal('F','fable',1),changes:[{path:'tokens.color.red.600.$value',value:'#B91C1C'}]};
  const merged=mergeProposals(a,f);
  assert.ok(merged.conflicts.some(conflict=>conflict.path==='tokens.radius.md.$value'));
});
