import React from 'react';
const h=React.createElement;
export default {title:'Constitution/Components',parameters:{layout:'padded'}};
const style={fontSize:'16px',paddingTop:'16px',paddingBottom:'16px',paddingLeft:'20px',paddingRight:'20px',background:'#ffffff',color:'#17213b',border:'1px solid #aab5c9',borderRadius:'8px'};
export const Button={render:()=>h('button',{id:'sample',style},'Save changes')};
export const Input={render:()=>h('label',null,'Project name ',h('input',{id:'sample',defaultValue:'Field notes',style}))};
export const Card={render:()=>h('article',{id:'sample',style},h('h2',null,'A quieter workday'),h('p',null,'A reusable card checked against the same approved rules.'))};
function DialogExample(){const [open,setOpen]=React.useState(false);return h('div',null,h('button',{id:'open',onClick:()=>setOpen(true)},'Open details'),open&&h('section',{id:'sample',role:'dialog','aria-label':'Project details',style},h('h2',null,'Project details'),h('button',{onClick:()=>setOpen(false)},'Close')));}
export const Dialog={render:()=>h(DialogExample),play:async({canvasElement})=>{canvasElement.querySelector('#open').click();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}};
export const Broken={render:()=>h('button',{id:'sample',style:{...style,fontSize:'12px',paddingTop:'3px'}},'Needs correction')};
export const Skipped={...Button,tags:['stylecon-skip']};
export const Failed={...Button,play:async()=>{throw new Error('Deliberate failed story');}};
export const Unfinished={...Button,play:()=>new Promise(()=>{})};
