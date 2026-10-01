import test from 'node:test';
import assert from 'node:assert/strict';
import { runConsensus, sha256 } from '../dist/packages/consensus-engine/src/index.js';

const context={brief:'Set radius to 10px',criteria:['Preserve other rules'],baseVersion:'0.6.0'};
const candidateOf=p=>({baseVersion:p.baseVersion,changes:p.changes});
const proposal=(role,value='10px',path='tokens.radius.md.$value')=>({id:role,author:role,baseVersion:context.baseVersion,summary:'Radius',changes:[{path,value}],tradeoffs:[],unresolved:[]});
const accept=async(role,p)=>({reviewer:role,proposalId:p.id,candidateHash:await sha256(candidateOf(p)),objections:[],acceptedPaths:p.changes.map(c=>c.path)});
function agent(role,initial=proposal(role),overrides={}){
  return {id:role,generateProposal:async()=>initial,critiqueProposal:p=>accept(role,p),reviseProposal:async()=>{throw new Error('Unnecessary revision');},...overrides};
}

test('accepted initial proposals stop after four calls without revision churn',async()=>{
  const run=await runConsensus({astra:agent('astra'),fable:agent('fable'),context});
  assert.equal(run.status,'CONSENSUS');
  assert.equal(run.rounds,1);
  assert.equal(run.critiques.length,2);
  assert.ok(run.critiques.every(c=>c.candidateHash===run.candidateHash));
});

test('both reviewers inspect the complete merged candidate including disjoint changes',async()=>{
  const seen=[];
  const make=(role,path)=>agent(role,proposal(role,'10px',path),{critiqueProposal:async p=>{seen.push(p.changes.map(c=>c.path));return accept(role,p);}});
  const run=await runConsensus({astra:make('astra','tokens.radius.md.$value'),fable:make('fable','tokens.space.2.$value'),context});
  assert.equal(run.status,'CONSENSUS');
  assert.deepEqual(seen,[['tokens.radius.md.$value','tokens.space.2.$value'],['tokens.radius.md.$value','tokens.space.2.$value']]);
  assert.ok(run.critiques.every(c=>c.candidateHash===run.candidateHash));
});

test('conflict revisions receive alternatives and finish with fresh exact-candidate reviews',async()=>{
  let revisions=0;
  const make=(role,value)=>agent(role,proposal(role,value),{reviseProposal:async(p,_c,ctx)=>{
    revisions++;
    assert.equal(ctx.reconciliation.conflicts[0].path,'tokens.radius.md.$value');
    assert.notEqual(ctx.reconciliation.counterpart.changes[0].value,p.changes[0].value);
    assert.ok(Object.isFrozen(ctx.reconciliation));
    return {...p,changes:[{path:'tokens.radius.md.$value',value:'10px'}]};
  }});
  const run=await runConsensus({astra:make('astra','8px'),fable:make('fable','12px'),context,maxRounds:2,evaluate:c=>c.changes[0].value==='10px'?[]:['Expected 10px']});
  assert.equal(run.status,'CONSENSUS');assert.equal(revisions,2);
  assert.ok(run.critiques.slice(-2).every(c=>c.candidateHash===run.candidateHash));
  assert.ok(run.critiques.slice(0,2).every(c=>c.candidateHash!==run.candidateHash));
});

test('stale, missing, or wrong actor reviews fail closed before revision',async()=>{
  for(const change of [{candidateHash:'0'.repeat(64)},{candidateHash:undefined},{reviewer:'fable'},{proposalId:'unrelated'}]){
    const a=agent('astra',proposal('astra'),{critiqueProposal:async p=>({...await accept('astra',p),...change})});
    await assert.rejects(runConsensus({astra:a,fable:agent('fable'),context}),/review.*(hash|identity)/i);
  }
});

test('omitted review coverage and unresolved issues cannot produce consensus',async()=>{
  const a=agent('astra',proposal('astra'),{critiqueProposal:async p=>({...await accept('astra',p),acceptedPaths:[]})});
  assert.equal((await runConsensus({astra:a,fable:agent('fable'),context,maxRounds:1})).status,'PARTIAL_CONSENSUS');
  const unresolved={...proposal('astra'),unresolved:['Need an explicit decision']};
  assert.equal((await runConsensus({astra:agent('astra',unresolved),fable:agent('fable'),context,maxRounds:1})).status,'PARTIAL_CONSENSUS');
});

test('last review round never spends calls on a revision that cannot be reviewed',async()=>{
  const run=await runConsensus({astra:agent('astra',proposal('astra','8px')),fable:agent('fable',proposal('fable','12px')),context,maxRounds:1});
  assert.equal(run.status,'DEADLOCK');
  await assert.rejects(runConsensus({astra:agent('astra'),fable:agent('fable'),context,maxRounds:0}),/round/i);
});

test('both reviewers must explicitly resolve every recorded issue on the reviewed proposal',async()=>{
  const pending={...proposal('astra'),unresolved:['Check the new radius']};
  const make=(role,resolve)=>agent(role,role==='astra'?pending:proposal(role),{critiqueProposal:async p=>({...await accept(role,p),resolvedIssues:resolve?[...p.unresolved]:[]})});
  assert.equal((await runConsensus({astra:make('astra',true),fable:make('fable',false),context,maxRounds:1})).status,'PARTIAL_CONSENSUS');
  assert.equal((await runConsensus({astra:make('astra',true),fable:make('fable',true),context,maxRounds:1})).status,'CONSENSUS');
});
