import test from 'node:test';
import assert from 'node:assert/strict';
import {formatReport} from '../scripts/standalone-check.mjs';

const report={status:'fail',artifactSha256:'a'.repeat(64),specSha256:'b'.repeat(64),
  runningApp:{viewports:[1280,390],journeyViewport:1280},limitations:['Other routes and states are untested.'],
  checks:[
    {ruleId:'FOCUS',check:'focus',target:'#open',status:'pass',fix:'Visible focus'},
    {ruleId:'FONT',check:'typography.fontSize',target:'#title',selector:'#actual',status:'fail',viewport:{width:390},fix:'Use the configured size'},
    {ruleId:'SPACE',check:'spacing.paddingTop',target:'#hidden',status:'not_checked',viewport:{width:390},limitation:'Target missing or hidden',fix:'Make this target visible and recheck'},
    {ruleId:'CONTRAST',check:'contrast',target:'#title',status:'unsupported',viewport:{width:1280},limitation:'<script>composited surface</script>',fix:'Review contrast manually'}
  ]};

test('text report shows evaluated denominator, incomplete reasons and distinct journey/measurement scope',()=>{
  const text=formatReport({report},{},'text');
  assert.match(text,/2 of 4 recorded checks evaluated/);
  assert.match(text,/1 passed.*1 failed.*1 not checked.*1 unsupported/);
  assert.match(text,/Journey viewport: 1280px/);
  assert.match(text,/Measurement viewports: 390px, 1280px/);
  assert.match(text,/Target missing or hidden/);
  assert.match(text,/#actual \(label #title\)/);
  assert.match(text,/Other routes and states are untested/);
});

test('HTML report surfaces coverage before findings and escapes incomplete explanations',()=>{
  const html=formatReport({report},{},'html');
  const coverageIndex=html.indexOf('2 of 4 recorded checks evaluated');
  assert.ok(coverageIndex>=0&&coverageIndex<html.indexOf('id="results"'));
  assert.match(html,/Target missing or hidden/);
  assert.match(html,/Make this target visible and recheck/);
  assert.ok(!html.includes('<script>composited'));
  assert.match(html,/&lt;script&gt;composited/);
});

test('older reports do not invent journey widths and empty evidence cannot imply complete coverage',()=>{
  const text=formatReport({report:{...report,runningApp:{viewports:[390,1280]}}},{},'text');
  assert.match(text,/Journey viewport: not recorded/);
  const empty=formatReport({report:{status:'not_checked',checks:[]}},{},'text');
  assert.match(empty,/No check evidence recorded/);
});
