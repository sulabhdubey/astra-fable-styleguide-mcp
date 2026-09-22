import test from 'node:test';
import assert from 'node:assert/strict';
import {setInput} from '../scripts/verify-project.mjs';
test('native select uses option selection rather than text filling',async()=>{
  const calls=[];let value='';
  const tab={playwright:{evaluate:async fn=>String(fn).includes('tagName')?'SELECT':value,
    locator:()=>({selectOption:async v=>{calls.push('select');value=v;},fill:async()=>{throw new Error('Cannot fill a select');}})}};
  await setInput(tab,'#field','choice');assert.deepEqual(calls,['select']);
});
