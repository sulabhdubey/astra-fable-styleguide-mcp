import test from 'node:test';
import assert from 'node:assert/strict';
import {appendProductChecks} from '../packages/browser-verification/src/product-checks.mjs';
const good=()=>({form:{selector:'#name',found:true,labelled:true,label:'Name',invalid:true,errorAssociated:true,errorVisible:true,focused:true},states:[{selector:'#disabled',kind:'disabled',found:true,nativeDisabled:true},{selector:'#loading',kind:'loading',found:true,busy:true,statusVisible:true}],layout:{viewportWidth:390,contentWidth:390},closePaths:[{closed:true,returnFocus:true}]});
const run=o=>appendProductChecks({checks:[]},o);
test('declared form, states, layout and close paths have positive and negative controls',()=>{
  assert.equal(run(good()).status,'pass');
  for(const [section,index,key,check] of [['form',null,'labelled','label'],['form',null,'errorAssociated','error-association'],['states',0,'nativeDisabled','disabled'],['states',1,'statusVisible','loading'],['closePaths',0,'returnFocus','close-path']]) {
    const o=good();(index===null?o[section]:o[section][index])[key]=false;
    assert.equal(run(o).checks.find(c=>c.check===check).status,'fail');
  }
  const o=good();o.layout.contentWidth=900;assert.equal(run(o).checks.find(c=>c.check==='overflow').status,'fail');
  o.form.found=false;assert.equal(run(o).checks.find(c=>c.check==='label').status,'not_checked');
});
