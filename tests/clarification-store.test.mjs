import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,unlinkSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ClarificationStore} from '../dist/apps/mcp-server/src/clarification-store.js';
const empty={heldHashes:[],contexts:[]};
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'clarification-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return join(dir,'holds.jsonl');}
test('store requires explicit initialization and restores saved snapshots',t=>{
  const path=fixture(t);assert.throws(()=>new ClarificationStore(path),/ENOENT/);
  ClarificationStore.initialize(path);const store=new ClarificationStore(path);
  assert.deepEqual(store.load(),empty);const state={heldHashes:['a'.repeat(64)],contexts:[]};
  store.save(state);state.heldHashes=[];
  assert.deepEqual(new ClarificationStore(path).load().heldHashes,['a'.repeat(64)]);
  assert.throws(()=>ClarificationStore.initialize(path),/EEXIST/);
});
test('deleted, truncated, changed and invalid stores fail closed',t=>{
  const path=fixture(t);ClarificationStore.initialize(path);const store=new ClarificationStore(path);
  const original=readFileSync(path);writeFileSync(path,original.subarray(0,original.length-1));
  assert.throws(()=>new ClarificationStore(path),/integrity/);
  assert.throws(()=>store.assertHealthy(),/integrity/);
  writeFileSync(path,original);assert.throws(()=>store.save(empty),/integrity/);
  unlinkSync(path);assert.throws(()=>new ClarificationStore(path),/ENOENT/);
});
test('another writer makes a stale store fail closed rather than overwrite',t=>{
  const path=fixture(t);ClarificationStore.initialize(path);const one=new ClarificationStore(path),two=new ClarificationStore(path);
  one.save({heldHashes:['b'.repeat(64)],contexts:[]});
  assert.throws(()=>two.save(empty),/integrity/);
  assert.deepEqual(new ClarificationStore(path).load().heldHashes,['b'.repeat(64)]);
});
test('store rejects nonregular paths and symbolic links',t=>{
  const path=fixture(t);ClarificationStore.initialize(path);
  const link=path+'.link';try{symlinkSync(path,link);}catch(error){if(error.code==='EPERM')return t.skip('Symlink permission unavailable');throw error;}
  assert.throws(()=>new ClarificationStore(link),/regular/);
});
