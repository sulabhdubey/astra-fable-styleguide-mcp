import test from 'node:test';
import assert from 'node:assert/strict';
import {runCheck, allowedRequest, formatReport} from '../scripts/standalone-check.mjs';

test('standalone checker blocks foreign origins, credentials, writes and metadata access',()=>{
  const origin='http://127.0.0.1:4567';
  assert.equal(allowedRequest(origin,origin+'/index.html','GET'),true);
  for(const [url,method] of [['https://example.com','GET'],['http://127.0.0.1:4568/','GET'],[origin+'/','POST'],[origin+'/_verification','GET'],['http://user@127.0.0.1:4567/','GET']])assert.equal(allowedRequest(origin,url,method),false);
});
test('report formats preserve incomplete status and omit invented source lines',()=>{
  const result={report:{status:'not_checked',checks:[{ruleId:'R',target:'#x',check:'focus',status:'unsupported',fix:'Review manually'}]}};
  const formatted=formatReport(result,{'#x':'index.html'},'sarif');
  const sarif=JSON.parse(formatted);
  assert.equal(sarif.runs[0].results[0].level,'warning');
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.region,undefined);
  assert.match(formatReport(result,{'#x':'index.html'},'text'),/R index.html.*unsupported/);
});
test('missing browser is an error, never a synthetic pass',async()=>{
  await assert.rejects(runCheck('examples/profile/project.json',{launch:async()=>{throw new Error('browser missing');}}),/browser missing/);
});
