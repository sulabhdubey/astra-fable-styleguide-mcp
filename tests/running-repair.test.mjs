import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRepairStylesheet, repairCandidate} from '../scripts/running-repair-map.mjs';

test('repair mapping preserves exact literal source offsets and canonical replacement',()=>{
  const source='#title { font-size: 20px; padding-top: 8px; }\n';
  const rules=parseRepairStylesheet(source);
  const candidate=repairCandidate({source:'src/public/title.css',build:'title.css'},source,rules[0],rules[0].declarations[0],'24px');
  assert.equal(source.slice(candidate.start,candidate.end),'20px');
  assert.equal(candidate.after,'24px');
  assert.equal(candidate.selector,'#title');
  assert.match(candidate.id,/^[a-f0-9]{64}$/);
});
test('repair subset rejects ambiguous, dynamic and transformed CSS',()=>{
  for(const source of ['h1{font-size:20px;}','#title{font-size:var(--size);}','#title{font-size:20px!important;}','@media(max-width:500px){#title{font-size:20px;}}','#title{font-size:20px;font-size:22px;}','#title{font-size:20px;}#title{font-size:22px;}','#title{padding:8px;}','#title{font-size:20px}'])assert.throws(()=>parseRepairStylesheet(source),/Unsupported|Duplicate/);
});
test('repair replacement is a bounded canonical pixel literal',()=>{
  const source='#title{font-size:20px;}';const rule=parseRepairStylesheet(source)[0];
  for(const value of ['var(--size)','20px','24px;color:red',-1,'10001px'])assert.throws(()=>repairCandidate({source:'src/public/title.css',build:'title.css'},source,rule,rule.declarations[0],value),/replacement/);
});
