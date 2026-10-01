import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,open,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as benchmark from '../scripts/compare-local-design.mjs';

test('private receipt checkpoints replace prior content with valid JSON',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'stylecon-receipt-')),path=join(directory,'receipt.json'),handle=await open(path,'wx');
  try{
    await benchmark.writeReceiptCheckpoint(handle,{status:'running',arms:[]});
    await benchmark.writeReceiptCheckpoint(handle,{status:'aborted',arms:[{caseId:'radius'}]});
    assert.deepEqual(JSON.parse(await readFile(path,'utf8')),{status:'aborted',arms:[{caseId:'radius'}]});
  }finally{await handle.close();await rm(directory,{recursive:true,force:true});}
});

test('local model preflight requires the selected model to be loaded before matched arms',async()=>{
  const loaded=await benchmark.readLocalModelLoadState('llama3.2:3b',async()=>new Response(JSON.stringify({models:[{name:'llama3.2:3b',digest:'abc',size_vram:123,expires_at:'later'}]}),{status:200}));
  assert.deepEqual(loaded,{name:'llama3.2:3b',digest:'abc',sizeVram:123,expiresAt:'later'});
  await assert.rejects(benchmark.readLocalModelLoadState('llama3.2:3b',async()=>new Response(JSON.stringify({models:[]}),{status:200})),/prewarm/i);
});

test('deadline rejects late fulfillment when synchronous work delays the timer callback',async()=>{
  const work=Promise.resolve().then(()=>{
    const until=Date.now()+40;
    while(Date.now()<until){} // Simulate a provider mock blocking timer delivery.
    return 'late success';
  });
  await assert.rejects(benchmark.withinDeadline(work,20),/time budget/i);
});

test('held-out comparison cases are fresh multi-constraint briefs',()=>{
  assert.equal(Array.isArray(benchmark.comparisonCases),true);
  assert.equal(benchmark.comparisonCases.length,3);
  const priorPaths=new Set(['tokens.radius.md.$value','tokens.size.control.md.$value','tokens.space.4.$value','tokens.typography.fontSize.200.$value','tokens.border.width.strong.$value','tokens.typography.lineHeight.normal.$value']);
  for(const definition of benchmark.comparisonCases){
    assert.equal(definition.expectedChanges.length,2);
    for(const change of definition.expectedChanges)assert.equal(priorPaths.has(change.path),false,change.path);
  }
});

test('readiness suite uses new change paths and independently validated expected outcomes',async()=>{
  const {loadCanonical}=await import('../scripts/load-spec.mjs');
  const canonical=await loadCanonical();
  const oldPaths=new Set([...benchmark.developmentCases,...benchmark.comparisonCases].flatMap(c=>c.expectedChanges.map(change=>change.path)));
  for(const definition of benchmark.readinessCases){
    assert.equal(definition.expectedChanges.length,2);
    assert.ok(definition.expectedChanges.every(change=>!oldPaths.has(change.path)));
    assert.deepEqual(benchmark.evaluateBrief({baseVersion:canonical.manifest.version,changes:definition.expectedChanges},definition,canonical),[]);
  }
});

test('bounded comparison evaluates multiple briefs with the same model and records real denominators',async()=>{
  assert.equal(typeof benchmark.compareDesignSuite,'function','A multi-brief bounded comparison is required');
  const seen=[];
  const invoke=async request=>{
    seen.push(request);
    const context=request.payload.context??request.payload;
    if(request.task==='critique')return {objections:[],acceptedPaths:request.payload.proposal.changes.map(c=>c.path)};
    if(request.task==='revision')return request.payload.proposal;
    const definition=benchmark.comparisonCases.find(definition=>definition.brief===context.brief);
    return {summary:'Bounded changes',changes:definition.expectedChanges,tradeoffs:['Synthetic test'],unresolved:[]};
  };
  const result=await benchmark.compareDesignSuite({model:'deterministic-test',invoke,maxCases:3});
  assert.equal(result.arms.length,6);
  assert.equal(result.summary.single.attempts,3);assert.equal(result.summary.pair.attempts,3);
  assert.ok(result.arms.every(a=>a.calls.length<=8&&a.model==='deterministic-test'));
  assert.equal(result.summary.single.calls,6,'A correct single workflow stops after proposal and review');
  assert.equal(result.summary.pair.calls,12,'A correct pair stops after two independent proposals and two reviews');
  assert.equal(seen.some(r=>r.task==='revision'),false);
  assert.equal(result.summary.pair.consensus,3);
  assert.equal(result.summary.pair.constraintScore,6);assert.equal(result.summary.single.constraintScore,6);
  assert.equal(result.advantage.demonstrated,false);
  assert.match(result.advantage.criterion,/strictly higher total constraint score/i);
  assert.equal(result.kind,'deterministic-harness-test');
  assert.ok(seen.filter(r=>r.task==='proposal').every(r=>!r.payload.proposal));
  assert.ok(seen.filter(r=>r.task!=='proposal').some(r=>r.payload.context?.deterministicFeedback));
});

test('comparison retains provider failures and rejects a zero call budget',async()=>{
  assert.equal(typeof benchmark.compareDesignSuite,'function');
  const result=await benchmark.compareDesignSuite({model:'test',invoke:async()=>{throw new Error('provider unavailable');},maxCases:1});
  assert.equal(result.arms.length,2);assert.ok(result.arms.every(a=>a.error.includes('provider unavailable')));
  assert.equal(result.summary.single.validCandidates,0);assert.equal(result.summary.pair.validCandidates,0);
  assert.equal(result.summary.single.erroredArms,1);assert.equal(result.summary.pair.erroredArms,1);
  assert.equal(result.summary.single.providerErrors,1);assert.equal(result.summary.pair.providerErrors,2);
  await assert.rejects(benchmark.compareDesignSuite({model:'test',invoke:async()=>({}),maxCalls:0}),/budget/i);
});

test('neither workflow can erase an unresolved issue by omitting it during revision',async()=>{
  const invoke=async request=>{
    if(request.task==='proposal')return {summary:'Correct values with pending decision',changes:benchmark.comparisonCases[0].expectedChanges,tradeoffs:[],unresolved:['Need the policy decision']};
    if(request.task==='revision')return {...request.payload.proposal,unresolved:[]};
    return {objections:[],acceptedPaths:request.payload.proposal.changes.map(c=>c.path),resolvedIssues:[]};
  };
  const result=await benchmark.compareDesignSuite({model:'test',invoke,maxCases:1});
  assert.equal(result.arms[0].result.status,'UNRESOLVED');
  assert.equal(result.arms[1].result.status,'PARTIAL_CONSENSUS');
  assert.equal(result.summary.single.validCandidates,0);assert.equal(result.summary.pair.validCandidates,0);
});

test('a slow first arm cannot consume the following arm time allowance',async()=>{
  let callCount=0;
  const invoke=async request=>{
    callCount+=1;
    if(callCount===2)await new Promise(resolve=>setTimeout(resolve,1400));
    if(request.task==='critique')return {objections:[],acceptedPaths:request.payload.proposal.changes.map(change=>change.path)};
    if(request.task==='revision')return request.payload.proposal;
    return {summary:'Two changes',changes:benchmark.comparisonCases[0].expectedChanges,tradeoffs:[],unresolved:[]};
  };
  const result=await benchmark.compareDesignSuite({model:'test',invoke,maxCases:1,maxDurationMs:1200});
  assert.match(result.arms[0].error,/budget/);
  assert.equal(result.arms[0].calls.length,2);
  assert.ok(result.arms[0].elapsedMs<1300,`deadline overrun: ${result.arms[0].elapsedMs}ms`);
  assert.ok(result.arms[0].calls.at(-1).effectiveTimeoutMs<=1200);
  assert.equal(result.arms[1].result?.status,'CONSENSUS');
});
