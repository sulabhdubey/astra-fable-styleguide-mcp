import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCandidates} from '../scripts/candidate-comparison.mjs';

function report(statuses,hash) {
  return {artifactSha256:hash.repeat(64),specSha256:'f'.repeat(64),projectConfigurationSha256:'e'.repeat(64),
    status:statuses.includes('fail')?'fail':statuses.every(s=>s==='pass')?'pass':'not_checked',
    checks:statuses.map((status,i)=>({ruleId:'RULE-'+i,check:'target',target:'#item-'+i,selector:'#item-'+i,
      viewport:{width:800,height:600},expected:{minimum:40},observed:{height:status==='pass'?40:24},status}))};
}
const inputs=()=>[report(['fail','pass'],'a'),report(['pass','pass'],'b'),report(['pass','fail'],'c')];
test('unique complete repair beats a regression, with exact report bindings',()=>{
  const result=compareCandidates(...inputs());
  assert.equal(result.preference,'A');assert.equal(result.exitCode,0);
  assert.equal(result.candidates[0].resolved.length,1);assert.equal(result.candidates[1].regressed.length,1);
  assert.match(result.bindings.baseline.reportSha256,/^[a-f0-9]{64}$/);assert.equal(result.historyOnly,true);
});
test('ties and partial repairs never invent a winner',()=>{
  const [base,a]=inputs();
  assert.equal(compareCandidates(base,a,report(['pass','pass'],'c')).preference,null);
  assert.equal(compareCandidates(base,report(['fail','pass'],'b'),report(['pass','fail'],'c')).preference,null);
});
test('incomplete candidates or baseline prevent preference',()=>{
  for(const index of [0,1,2]) {
    const args=inputs();args[index]=report(['not_checked','pass'],['a','b','c'][index]);
    const result=compareCandidates(...args);assert.equal(result.preference,null);assert.equal(result.exitCode,2);
  }
});
test('scope changes, duplicate identities and malformed evidence fail closed',()=>{
  const mutations=[
    r=>{r.checks[0].expected.minimum=48;},r=>{r.checks[0].viewport.height=900;},
    r=>{r.checks[0].selector='#different';},r=>{r.projectConfigurationSha256='d'.repeat(64);},
    r=>{r.checks[1]=r.checks[0];},r=>{r.checks[0]=null;},r=>{delete r.specSha256;},
    r=>{r.browserScope={keyboard:false};},r=>{r.checks[0].status='unknown';},
    r=>{r.checks[0].expected=null;},r=>{r.checks[0].observed=null;},
  ];
  for(const mutate of mutations) {
    const args=inputs();mutate(args[1]);const result=compareCandidates(...args);
    assert.equal(result.preference,null);assert.equal(result.exitCode,2);
  }
});
test('same source with conflicting recorded outcomes is unresolved',()=>{
  const [base,a,b]=inputs();a.artifactSha256=base.artifactSha256;
  assert.equal(compareCandidates(base,a,b).exitCode,2);
});
test('object property order and measured values do not change scope',()=>{
  const args=inputs();args[1].checks.reverse();
  args[1].checks[0].viewport={height:600,width:800};
  args[1].checks[0].observed.height=45;
  assert.equal(compareCandidates(...args).preference,'A');
});
test('legacy canonical journey thresholds remain requirements, not outcomes',()=>{
  const args=inputs();
  for(const report of args)for(const check of report.checks) {
    check.ruleId='STYLE-A11Y-009';delete check.expected;check.observed.minimum=40;
  }
  assert.equal(compareCandidates(...args).preference,'A');
  args[1].checks[0].observed.minimum=48;
  assert.equal(compareCandidates(...args).exitCode,2);
});
