import test from 'node:test';import assert from 'node:assert/strict';import {loadBundle} from './helpers.mjs';
import {evaluateSpec,contrastRatio} from '../dist/packages/evaluator/src/index.js';import {validateTokenGraph} from '../dist/packages/style-spec/src/index.js';
test('canonical spec passes deterministic evaluation',async()=>{const b=await loadBundle();const r=evaluateSpec(b);assert.equal(r.valid,true,JSON.stringify(r.issues));});
test('broken token reference is rejected',()=>{const r=validateTokenGraph({a:{$value:'{missing.x}'}});assert.ok(r.some(i=>i.code==='STYLE-TOKEN-001'));});
test('circular token reference is rejected',()=>{const r=validateTokenGraph({a:{$value:'{b}'},b:{$value:'{a}'}});assert.ok(r.some(i=>i.code==='STYLE-TOKEN-002'));});
test('contrast math detects weak pair',()=>{assert.ok(contrastRatio('#777777','#FFFFFF')<4.5);});
test('declared dimension token rejects an object value',()=>{
  const issues=validateTokenGraph({radius:{md:{$type:'dimension',$value:{$type:'dimension',$value:'12px'}}}});
  assert.ok(issues.some(issue=>issue.code==='STYLE-TOKEN-004'&&issue.path==='radius.md'),JSON.stringify(issues));
});
test('declared token value shapes accept the canonical primitive and easing forms',()=>{
  const issues=validateTokenGraph({radius:{md:{$type:'dimension',$value:'12px'}},lineHeight:{$type:'number',$value:1.5},ease:{$type:'cubicBezier',$value:[0.2,0,0,1]}});
  assert.deepEqual(issues,[]);
});
test('a color token cannot resolve to a dimension token',()=>{
  const issues=validateTokenGraph({radius:{$type:'dimension',$value:'8px'},semantic:{$type:'color',$value:'{radius}'}});
  assert.ok(issues.some(issue=>issue.code==='STYLE-TOKEN-004'&&issue.path==='semantic'),JSON.stringify(issues));
});
