import test from 'node:test';import assert from 'node:assert/strict';import {loadBundle} from './helpers.mjs';
import {evaluateSpec,contrastRatio} from '../dist/packages/evaluator/src/index.js';import {validateTokenGraph,getPath,setPath,addPath} from '../dist/packages/style-spec/src/index.js';
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
test('shadow tokens reject names and malformed colors while accepting declared CSS shadow forms',()=>{
  const invalid=validateTokenGraph({elevation:{md:{$type:'shadow',$value:"'lg'"},badColor:{$type:'shadow',$value:'0 8px 24px rgba(999, 23, 42, 0.12)'},badAlpha:{$type:'shadow',$value:'0 8px 24px rgba(15, 23, 42, 1.2)'},negativeBlur:{$type:'shadow',$value:'0 8px -24px #0F172A'}}});
  assert.deepEqual(invalid.filter(issue=>issue.code==='STYLE-TOKEN-004').map(issue=>issue.path),['elevation.md','elevation.badColor','elevation.badAlpha','elevation.negativeBlur']);
  const valid=validateTokenGraph({elevation:{none:{$type:'shadow',$value:'none'},md:{$type:'shadow',$value:'0 8px 24px rgba(15, 23, 42, 0.12)'},inset:{$type:'shadow',$value:'inset 0 1px 2px #0F172A'}}});
  assert.deepEqual(valid,[]);
});
test('path lookup and replacement do not follow inherited object properties',()=>{
  assert.equal(getPath({},'toString'),undefined);
  assert.throws(()=>setPath({},'toString','changed'),/Unknown path/);
  assert.ok(validateTokenGraph({alias:{$type:'string',$value:'{toString}'}}).some(issue=>issue.code==='STYLE-TOKEN-001'));
});
test('path writes reject empty segments rather than changing a different path',()=>{
  const root={tokens:{semantic:{}}};
  assert.throws(()=>addPath(root,'tokens.semantic..new',{$type:'color',$value:'#FFFFFF'}),/empty segment/);
  assert.equal(getPath(root,'tokens.semantic.new'),undefined);
});
