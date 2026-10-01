/* global document, getComputedStyle, CSSStyleSheet */
import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const pixel=value=>typeof value==='string'&&/^(?:0|[1-9]\d*)(?:\.\d+)?px$/.test(value)&&Number.parseFloat(value)<=10000;
const names={'font-size':'fontSize','padding-top':'paddingTop'};

/** Deliberately small source grammar: plain ID rules and literal longhands only. */
export function parseRepairStylesheet(source) {
  if(typeof source!=='string'||Buffer.byteLength(source)>100000)throw new Error('Unsupported repair stylesheet');
  const rules=[];let cursor=0;const selectors=new Set();
  const pattern=/\s*(#[A-Za-z][\w-]*)\s*\{([^{}]*)\}/gy;
  while(cursor<source.length&&source.slice(cursor).trim()) {
    pattern.lastIndex=cursor;const match=pattern.exec(source);
    if(!match)throw new Error('Unsupported repair stylesheet syntax');
    const selector=match[1];if(selectors.has(selector))throw new Error('Duplicate repair selector');selectors.add(selector);
    const body=match[2],bodyStart=match.index+match[0].indexOf('{')+1;const declarations=[];let position=0;
    const declaration=/\s*(font-size|padding-top)\s*:\s*((?:0|[1-9]\d*)(?:\.\d+)?px)\s*;/gy;
    while(position<body.length&&body.slice(position).trim()) {
      declaration.lastIndex=position;const entry=declaration.exec(body);
      if(!entry||!pixel(entry[2]))throw new Error('Unsupported repair declaration');
      if(declarations.some(item=>item.property===entry[1]))throw new Error('Duplicate repair declaration');
      const start=bodyStart+entry.index+entry[0].indexOf(entry[2]);
      declarations.push({property:entry[1],value:entry[2],start,end:start+entry[2].length});position=declaration.lastIndex;
    }
    if(!declarations.length)throw new Error('Unsupported empty repair rule');
    rules.push({selector,index:rules.length,declarations});cursor=pattern.lastIndex;
  }
  if(!rules.length)throw new Error('Unsupported empty repair stylesheet');return rules;
}
export function repairCandidate(mapping,source,rule,declaration,after) {
  if(!pixel(after)||after===declaration.value)throw new Error('Unsupported repair replacement');
  const candidate={path:mapping.source,build:mapping.build,sourceSha256:hash(source),selector:rule.selector,property:declaration.property,start:declaration.start,end:declaration.end,before:declaration.value,after};
  return {...candidate,id:hash(JSON.stringify(candidate))};
}

/** A reversible browser-only intervention proves the mapped declaration controls the measurement. */
export async function observeRepairCandidates(page,project,measured) {
  const candidates=[];
  for(const stylesheet of project.repairStylesheets??[])for(const rule of stylesheet.rules)for(const declaration of rule.declarations) {
    const measurement=measured.find(item=>item.selector===rule.selector&&item.found);
    const property=names[declaration.property],expected=measurement?.expected[declaration.property==='font-size'?'typography':'spacing']?.[property];
    if(!pixel(expected)||!pixel(measurement?.observed[property])||expected===measurement.observed[property]||expected===declaration.value)continue;
    const candidate=repairCandidate(stylesheet,stylesheet.text,rule,declaration,expected);
    const proof=await page.evaluate(({href,source,selector,index,property,oldValue,nextValue})=>{
      const elements=document.querySelectorAll(selector);if(elements.length!==1)return false;
      const element=elements[0];const sheets=[...document.styleSheets].filter(sheet=>sheet.href===href);
      if(sheets.length!==1||sheets[0].disabled||sheets[0].media.mediaText)return false;
      const sheet=sheets[0];const expected=new CSSStyleSheet();expected.replaceSync(source);
      const serialize=sheet=>[...sheet.cssRules].map(rule=>rule.cssText).join('\n');
      if(serialize(sheet)!==serialize(expected))return false;
      const rule=sheet.cssRules[index];if(rule?.selectorText!==selector||rule.style.getPropertyValue(property)!==oldValue||rule.style.getPropertyPriority(property))return false;
      const before=getComputedStyle(element).getPropertyValue(property);if(before!==oldValue)return false;
      // Two distinct interventions distinguish a winning declaration from coincidental equality.
      const sentinel=nextValue==='7px'?'11px':'7px';let changed=false,canonical=false;
      try {rule.style.setProperty(property,sentinel);changed=getComputedStyle(element).getPropertyValue(property)===sentinel;rule.style.setProperty(property,nextValue);canonical=getComputedStyle(element).getPropertyValue(property)===nextValue;}
      finally {rule.style.setProperty(property,oldValue);}
      return changed&&canonical&&getComputedStyle(element).getPropertyValue(property)===before&&serialize(sheet)===serialize(expected);
    },{href:new URL(stylesheet.build,project.config.url).href,source:stylesheet.text,selector:rule.selector,index:rule.index,property:declaration.property,oldValue:declaration.value,nextValue:expected});
    if(proof)candidates.push({...candidate,target:measurement.target,check:declaration.property==='font-size'?'typography.fontSize':'spacing.paddingTop',viewport:measurement.viewport.width,proof:'byte-identical stylesheet; exact CSSOM; reversible declaration intervention'});
  }
  return candidates;
}
