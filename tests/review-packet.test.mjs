import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {renderHtmlReport} from '../scripts/html-report.mjs';
import {createReviewPacket,verifyReviewPacket,renderReviewPacket} from '../scripts/review-packet.mjs';

const check=(target,status='fail')=>({ruleId:'STYLE-A11Y-009',check:'target',target,status,selector:target,observed:{height:24,minimum:40},expected:{minimum:40}});
const report=checks=>({schemaVersion:1,status:checks.some(c=>c.status==='fail')?'fail':checks.every(c=>c.status==='pass')?'pass':'not_checked',artifactSha256:'a'.repeat(64),specSha256:'b'.repeat(64),projectConfigurationSha256:'c'.repeat(64),checks});

test('review packet carries every result, aliases targets and keeps gaps visible',()=>{
  const input=report([check('#private'),check('#other','pass'),check('#private','not_checked')]);
  input.checks[2].check='focus';
  const packet=createReviewPacket(input);
  assert.equal(packet.checks.length,3);
  assert.deepEqual(packet.counts,{pass:1,fail:1,not_checked:1,unsupported:0});
  assert.equal(packet.status,'incomplete');
  assert.equal(packet.checks[0].target,'Element 1');assert.equal(packet.checks[2].target,'Element 1');
  assert.equal(packet.checks[1].target,'Element 2');
  assert.equal(packet.checks[0].observed.height,24);
  assert.equal(packet.bindings.artifactSha256,input.artifactSha256);
  assert.equal(packet.authority,'observation-only');
  assert.doesNotMatch(JSON.stringify(packet),/#private|#other/);
  assert.equal(verifyReviewPacket(JSON.parse(JSON.stringify(packet))).packetSha256,packet.packetSha256);
});

test('review projection excludes private names, diagnostics, raw source and nested arbitrary text',()=>{
  const input=report([{...check('#PRIVATE'),observed:{height:24,minimum:40,label:'PRIVATE NAME',error:'PRIVATE ERROR',source:'PRIVATE SOURCE',html:'<script>PRIVATE</script>',path:'C:\\PRIVATE',session:'PRIVATE SESSION',extra:{height:123}},fix:'PRIVATE FIX'}]);
  input.constitution={name:'PRIVATE CONSTITUTION'};input.limitations=['PRIVATE LIMITATION'];input.repair={receipt:'PRIVATE RECEIPT'};
  const packet=createReviewPacket(input),text=JSON.stringify(packet);
  assert.doesNotMatch(text,/PRIVATE|script|receipt/);
  assert.ok(packet.checks[0].omitted>0);
  assert.equal(packet.checks[0].observed.height,24);
  assert.ok(packet.disclosure.omittedFields>0);
  assert.match(renderReviewPacket(packet),/Omitted/);
});

test('unknown checks remain visible without exporting arbitrary identifiers',()=>{
  const packet=createReviewPacket(report([{...check('#private','unsupported'),check:'PRIVATE UNKNOWN',ruleId:'PRIVATE RULE'}]));
  assert.equal(packet.checks[0].check,'Other configured check');
  assert.equal(packet.counts.unsupported,1);
  assert.doesNotMatch(JSON.stringify(packet),/PRIVATE/);
});

test('review packet rejects inconsistent or duplicate coverage and unsupported inputs',()=>{
  const c=check('#one');
  for(const input of [report([]),report([c,c]),{...report([c]),status:'pass'},{...report([c]),schemaVersion:99},{...report([c]),artifactSha256:'bad'}])assert.throws(()=>createReviewPacket(input));
});

test('review integrity check rejects altered counts, removed checks and unknown fields',()=>{
  const original=createReviewPacket(report([check('#one'),check('#two','pass')]));
  for(const mutate of [p=>p.checks.pop(),p=>p.counts.pass++,p=>p.status='pass',p=>p.authority='approved',p=>p.source='private',p=>p.schemaVersion=99]){
    const packet=JSON.parse(JSON.stringify(original));mutate(packet);assert.throws(()=>verifyReviewPacket(packet));assert.throws(()=>renderReviewPacket(packet));
  }
});

test('even rehashed malformed packets cannot hide failures or inject unknown output fields',()=>{
  for(const mutate of [p=>p.counts.pass++,p=>p.checks[0].observed={secret:'PRIVATE'},p=>p.checks[0].check='<script>bad()</script>',p=>p.checks[0].target='Element 8',p=>p.checks[0].viewport={width:-1}]){
    const packet=createReviewPacket(report([check('#one')]));mutate(packet);
    const {packetSha256:_old,...payload}=packet;packet.packetSha256=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    assert.throws(()=>verifyReviewPacket(packet));
  }
});

test('simpler existing report preserves developer details while recipient projection omits them',()=>{
  const input=report([{...check('#PRIVATE-TARGET'),fix:'PRIVATE DIAGNOSTIC',observed:{height:24,label:'PRIVATE PERSON'}}]);
  const baseline=renderHtmlReport(input,{'#PRIVATE-TARGET':'PRIVATE-PATH.html'});
  assert.match(baseline,/PRIVATE-PATH/);assert.match(baseline,/PRIVATE PERSON/);
  assert.doesNotMatch(renderReviewPacket(createReviewPacket(input)),/PRIVATE/);
});

test('recipient HTML has no active content or links and discloses limited trust',()=>{
  const html=renderReviewPacket(createReviewPacket(report([check('#private')])));
  assert.doesNotMatch(html,/<script|<iframe|<img|<form|https?:|file:|onclick=/i);
  assert.match(html,/default-src 'none'/);assert.match(html,/not a signature/i);
  assert.match(html,/not.*accessibility certification/i);
  assert.match(html,/Every recorded check/);
});

test('recipient measurements use readable labels and units while retaining exact packet data',()=>{
  const html=renderReviewPacket(createReviewPacket(report([check('#one')])));
  assert.match(html,/<dt>Height<\/dt><dd>24 px<\/dd>/);
  assert.match(html,/<dt>Minimum<\/dt><dd>40 px<\/dd>/);
});
