import test from 'node:test';
import assert from 'node:assert/strict';
import * as benchmark from '../scripts/compare-local-design.mjs';

test('bounded comparison evaluates multiple briefs with the same model and records real denominators',async()=>{
  assert.equal(typeof benchmark.compareDesignSuite,'function','A multi-brief bounded comparison is required');
  const seen=[];
  const invoke=async request=>{
    seen.push(request);
    const context=request.payload.context??request.payload;
    if(request.task==='critique')return {objections:[],acceptedPaths:request.payload.proposal.changes.map(c=>c.path)};
    if(request.task==='revision')return request.payload.proposal;
    const spec=context.referenceSpec;
    const [path,value]=spec.tokens.radius?['tokens.radius.md.$value','12px']:spec.tokens.size?['tokens.size.control.md.$value','48px']:['tokens.space.4.$value','20px'];
    return {summary:'One bounded change',changes:[{path,value}],tradeoffs:['Synthetic test'],unresolved:[]};
  };
  const result=await benchmark.compareDesignSuite({model:'deterministic-test',invoke,maxCases:3});
  assert.equal(result.arms.length,6);
  assert.equal(result.summary.single.attempts,3);assert.equal(result.summary.pair.attempts,3);
  assert.ok(result.arms.every(a=>a.calls.length<=6&&a.model==='deterministic-test'));
  assert.equal(result.summary.pair.consensus,3);
  assert.equal(result.kind,'deterministic-harness-test');
  assert.ok(seen.filter(r=>r.task==='proposal').every(r=>!r.payload.proposal));
});

test('comparison retains provider failures and rejects a zero call budget',async()=>{
  assert.equal(typeof benchmark.compareDesignSuite,'function');
  const result=await benchmark.compareDesignSuite({model:'test',invoke:async()=>{throw new Error('provider unavailable');},maxCases:1});
  assert.equal(result.arms.length,2);assert.ok(result.arms.every(a=>a.error.includes('provider unavailable')));
  assert.equal(result.summary.single.validCandidates,0);assert.equal(result.summary.pair.validCandidates,0);
  await assert.rejects(benchmark.compareDesignSuite({model:'test',invoke:async()=>({}),maxCalls:0}),/budget/i);
});

test('a slow first arm cannot consume the following arm time allowance',async()=>{
  let first=true;
  const invoke=async request=>{
    if(first){first=false;await new Promise(resolve=>setTimeout(resolve,1100));}
    if(request.task==='critique')return {objections:[],acceptedPaths:['tokens.radius.md.$value']};
    if(request.task==='revision')return request.payload.proposal;
    return {summary:'One change',changes:[{path:'tokens.radius.md.$value',value:'12px'}],tradeoffs:[],unresolved:[]};
  };
  const result=await benchmark.compareDesignSuite({model:'test',invoke,maxCases:1,maxDurationMs:1000});
  assert.match(result.arms[0].error,/budget/);
  assert.equal(result.arms[1].result?.status,'CONSENSUS');
});
