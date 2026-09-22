import test from 'node:test';
import assert from 'node:assert/strict';
import {setInput} from '../scripts/verify-project.mjs';
test('empty input uses keyboard clear and verifies action before inferring product failures',async()=>{
  let value='old';const keys=[];
  const tab={playwright:{locator:()=>({press:async k=>{keys.push(k);if(k==='Backspace')value='';},fill:async v=>{if(v)value=v;}}),evaluate:async()=>value}};
  await setInput(tab,'#input','');assert.deepEqual(keys,['ControlOrMeta+A','Backspace']);
  await setInput(tab,'#input','new');assert.equal(value,'new');
  tab.playwright.evaluate=async()=> 'unchanged';
  await assert.rejects(setInput(tab,'#input','wanted'),/setup failed/);
});
