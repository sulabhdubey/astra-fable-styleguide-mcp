import test from 'node:test';import assert from 'node:assert/strict';import {loadBundle} from './helpers.mjs';
import {evaluateSpec,contrastRatio} from '../dist/packages/evaluator/src/index.js';import {validateTokenGraph} from '../dist/packages/style-spec/src/index.js';
test('canonical spec passes deterministic evaluation',async()=>{const b=await loadBundle();const r=evaluateSpec(b);assert.equal(r.valid,true,JSON.stringify(r.issues));});
test('broken token reference is rejected',()=>{const r=validateTokenGraph({a:{$value:'{missing.x}'}});assert.ok(r.some(i=>i.code==='STYLE-TOKEN-001'));});
test('circular token reference is rejected',()=>{const r=validateTokenGraph({a:{$value:'{b}'},b:{$value:'{a}'}});assert.ok(r.some(i=>i.code==='STYLE-TOKEN-002'));});
test('contrast math detects weak pair',()=>{assert.ok(contrastRatio('#777777','#FFFFFF')<4.5);});
