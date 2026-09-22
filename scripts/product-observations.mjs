/* global document, getComputedStyle */
// Self-contained so browser adapters can evaluate this read-only DOM collector.
export function readProductState({form,states=[]}) {
  const visible=node=>{
    if(!node || !node.getClientRects().length) return false;
    const rect=node.getBoundingClientRect();
    if(rect.width<=0 || rect.height<=0) return false;
    for(let n=node;n;n=n.parentElement) {
      const style=getComputedStyle(n);
      if(style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0||n.getAttribute('aria-hidden')==='true') return false;
    }
    return true;
  };
  const references=(node,attribute)=>[...new Set((node.getAttribute(attribute)??'').trim().split(/\s+/).filter(Boolean))].map(id=>document.getElementById(id)).filter(Boolean);
  const text=node=>node.textContent.trim();
  const result={states:states.map(state=>{
    const nodes=document.querySelectorAll(state.selector);const node=nodes[0];
    if(nodes.length!==1) return {...state,found:false};
    const statuses=references(node,'aria-describedby').filter(n=>n.getAttribute('role')==='status');
    return {...state,found:true,nativeDisabled:node.disabled===true,busy:node.getAttribute('aria-busy')==='true',statusVisible:statuses.some(n=>visible(n)&&!!text(n))};
  })};
  if(form) {
    const nodes=document.querySelectorAll(form.input);const node=nodes[0];
    if(nodes.length!==1) result.form={selector:form.input,found:false};
    else {
      const labels=[...node.labels??[]].filter(visible);
      const errors=node.hasAttribute('aria-errormessage')?references(node,'aria-errormessage'):references(node,'aria-describedby');
      const shown=errors.filter(n=>visible(n)&&!!text(n));
      result.form={selector:form.input,found:true,labelled:labels.some(n=>!!text(n)),label:labels.map(text).join(' '),invalid:node.getAttribute('aria-invalid')==='true',errorAssociated:errors.length>0,errorVisible:shown.length>0,errorText:shown.map(text).join(' '),focused:document.activeElement===node};
    }
  }
  return result;
}
