import test from 'node:test';
import assert from 'node:assert/strict';
import {readProductState} from '../scripts/product-observations.mjs';
test('collector supports multiple IDs and rejects hidden ancestors without requiring alert role',()=>{
  const nodes=new Map();
  const node=(id,attrs={},parent=null,style={})=>{const value={textContent:id,parentElement:parent,labels:[],disabled:false,getAttribute:key=>attrs[key]??null,hasAttribute:key=>Object.hasOwn(attrs,key),getClientRects:()=>[{}],getBoundingClientRect:()=>({width:100,height:20}),style:{visibility:'visible',display:'block',opacity:'1',...style}};nodes.set(id,value);return value;};
  const status=node('status',{role:'status'}),hidden=node('parent',{},null,{visibility:'hidden'});
  node('hidden',{role:'status'},hidden);node('busy',{'aria-busy':'true','aria-describedby':'hint status'});node('bad',{'aria-busy':'true','aria-describedby':'hidden'});node('hint');node('error');
  const input=node('input',{'aria-invalid':'true','aria-describedby':'hint error'});input.labels=[node('Label')];
  const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),oldStyle=Object.getOwnPropertyDescriptor(globalThis,'getComputedStyle');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:id=>nodes.get(id),querySelectorAll:selector=>nodes.has(selector.slice(1))?[nodes.get(selector.slice(1))]:[],activeElement:input}});
  Object.defineProperty(globalThis,'getComputedStyle',{configurable:true,value:n=>n.style});
  try {
    const result=readProductState({form:{input:'#input'},states:[{selector:'#busy',kind:'loading'},{selector:'#bad',kind:'loading'}]});
    assert.equal(result.states[0].statusVisible,true);assert.equal(result.states[1].statusVisible,false);
    assert.equal(result.form.errorVisible,true);assert.equal(result.form.labelled,true);assert.equal(result.form.focused,true);
    status.style.opacity='0';assert.equal(readProductState({states:[{selector:'#busy'}]}).states[0].statusVisible,false);
  }finally {
    if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else delete globalThis.document;
    if(oldStyle)Object.defineProperty(globalThis,'getComputedStyle',oldStyle);else delete globalThis.getComputedStyle;
  }
});
