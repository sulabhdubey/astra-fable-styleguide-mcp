import { getPath, isRecord, resolveToken, tokenReference, validateTokenGraph, type ValidationIssue } from '../../style-spec/src/index.js';

export interface AccessibilityPair { id: string; foreground: string; background: string; minimum: number; }
export interface EvaluationBundle { manifest: unknown; tokens: unknown; components: unknown[]; accessibility: unknown; patterns?: unknown; }
export interface EvaluationResult { valid: boolean; issues: ValidationIssue[]; metrics: { errors: number; warnings: number; }; }

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lum([r,g,b]: [number,number,number]): number {
  const f=(v:number)=>{ const c=v/255; return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4; };
  return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);
}
export function contrastRatio(fg: string, bg: string): number {
  const a=hexToRgb(fg), b=hexToRgb(bg); if (!a||!b) return 0;
  const la=lum(a), lb=lum(b); const hi=Math.max(la,lb), lo=Math.min(la,lb); return (hi+0.05)/(lo+0.05);
}

export function validateManifest(manifest: unknown): ValidationIssue[] {
  if (!isRecord(manifest)) return [{code:'STYLE-SCHEMA-001',path:'manifest',message:'Manifest must be an object',severity:'error'}];
  const issues: ValidationIssue[]=[];
  for (const key of ['name','version','status','schemaVersion','compatibility']) if (!(key in manifest)) issues.push({code:'STYLE-SCHEMA-002',path:`manifest.${key}`,message:`Missing required manifest field ${key}`,severity:'error'});
  if (typeof manifest.version==='string' && !/^\d+\.\d+\.\d+$/.test(manifest.version)) issues.push({code:'STYLE-SCHEMA-003',path:'manifest.version',message:'Version must be semantic x.y.z',severity:'error'});
  return issues;
}

export function validateComponents(components: unknown[], tokenRoot: unknown, knownRuleIds?: Set<string>): ValidationIssue[] {
  const issues: ValidationIssue[]=[]; const required=['default','hover','focus','disabled'];
  for (const raw of components) {
    if (!isRecord(raw) || typeof raw.id!=='string') { issues.push({code:'STYLE-COMP-001',path:'components',message:'Component needs a string id',severity:'error'}); continue; }
    const id=raw.id; const states=Array.isArray(raw.states)?raw.states:[];
    for (const state of required) if (!states.includes(state)) issues.push({code:'STYLE-COMP-002',path:`components.${id}.states`,message:`Missing state ${state}`,severity:'error'});
    const a11y=isRecord(raw.accessibility)?raw.accessibility:{};
    if (a11y.focusVisible!==true) issues.push({code:'STYLE-A11Y-001',path:`components.${id}.accessibility.focusVisible`,message:'Interactive component must define visible focus',severity:'error'});
    if(a11y.errorTextRequired!==undefined&&typeof a11y.errorTextRequired!=='boolean')issues.push({code:'STYLE-COMP-003',path:`components.${id}.accessibility.errorTextRequired`,message:'errorTextRequired must be boolean',severity:'error'});
    if(a11y.errorAssociation!==undefined&&(typeof a11y.errorAssociation!=='string'||!a11y.errorAssociation.trim()))issues.push({code:'STYLE-COMP-003',path:`components.${id}.accessibility.errorAssociation`,message:'errorAssociation must be nonempty text',severity:'error'});
    if(knownRuleIds&&a11y.ruleIds!==undefined){
      if(!Array.isArray(a11y.ruleIds))issues.push({code:'STYLE-COMP-003',path:`components.${id}.accessibility.ruleIds`,message:'Accessibility ruleIds must be a list',severity:'error'});
      else for(const ruleId of a11y.ruleIds)if(typeof ruleId!=='string'||!knownRuleIds.has(ruleId))issues.push({code:'STYLE-COMP-003',path:`components.${id}.accessibility.ruleIds`,message:`Unknown accessibility rule ${String(ruleId)}`,severity:'error'});
    }
    for(const key of ['contentRules','do','dont'])if(raw[key]!==undefined&&(!Array.isArray(raw[key])||(raw[key] as unknown[]).some(item=>typeof item!=='string'||!item.trim())))issues.push({code:'STYLE-COMP-003',path:`components.${id}.${key}`,message:`${key} must be a list of nonempty strings`,severity:'error'});
    const tokens=isRecord(raw.tokens)?raw.tokens:{};
    for (const [name,val] of Object.entries(tokens)) {
      const ref=tokenReference(val); if (!ref) issues.push({code:'STYLE-TOKEN-003',path:`components.${id}.tokens.${name}`,message:'Component token assignments must be token references',severity:'warning'});
      else if (getPath(tokenRoot, ref)===undefined) issues.push({code:'STYLE-TOKEN-001',path:`components.${id}.tokens.${name}`,message:`Unknown token ${ref}`,severity:'error'});
    }
  }
  return issues;
}

export function validateAccessibility(value: unknown): ValidationIssue[] {
  const issues:ValidationIssue[]=[];
  if(!isRecord(value))return [{code:'STYLE-SCHEMA-004',path:'accessibility',message:'Accessibility must be an object',severity:'error'}];
  for(const key of ['rules','contrastPairs']){
    const entries=value[key];
    if(!Array.isArray(entries)||entries.length===0){issues.push({code:'STYLE-SCHEMA-004',path:`accessibility.${key}`,message:`${key} must be a nonempty list`,severity:'error'});continue;}
    const ids=new Set<string>();
    for(const [index,entry] of entries.entries()){
      const path=`accessibility.${key}.${index}`;
      if(!isRecord(entry)||typeof entry.id!=='string'||!/^STYLE-A11Y-\d{3}$/.test(entry.id)||ids.has(entry.id)){issues.push({code:'STYLE-SCHEMA-004',path,message:'Accessibility entry needs a unique rule id',severity:'error'});continue;}
      ids.add(entry.id);
      if(key==='rules'){
        if(typeof entry.name!=='string'||!entry.name.trim()||typeof entry.requirement!=='string'||!entry.requirement.trim())issues.push({code:'STYLE-SCHEMA-004',path,message:'Accessibility rule needs a name and requirement',severity:'error'});
      }else if(typeof entry.foreground!=='string'||!entry.foreground.trim()||typeof entry.background!=='string'||!entry.background.trim()||typeof entry.minimum!=='number'||!Number.isFinite(entry.minimum)||entry.minimum<=0||entry.minimum>21)issues.push({code:'STYLE-SCHEMA-004',path,message:'Contrast pair needs token paths and a valid minimum',severity:'error'});
    }
  }
  return issues;
}

export function validatePatterns(value: unknown): ValidationIssue[] {
  if(value===undefined)return [];
  if(!Array.isArray(value))return [{code:'STYLE-SCHEMA-005',path:'patterns',message:'Patterns must be a list',severity:'error'}];
  const issues:ValidationIssue[]=[],ids=new Set<string>();
  for(const [index,pattern] of value.entries()){
    const path=`patterns.${index}`;
    if(!isRecord(pattern)||typeof pattern.id!=='string'||!pattern.id.trim()||ids.has(pattern.id)){issues.push({code:'STYLE-SCHEMA-005',path,message:'Pattern needs a unique id',severity:'error'});continue;}
    ids.add(pattern.id);
    if(typeof pattern.name!=='string'||!pattern.name.trim()||!Array.isArray(pattern.rules)||pattern.rules.length===0||pattern.rules.some(rule=>typeof rule!=='string'||!rule.trim()))issues.push({code:'STYLE-SCHEMA-005',path,message:'Pattern needs a name and nonempty rule list',severity:'error'});
  }
  return issues;
}

export function validateContrast(tokenRoot: unknown, pairs: AccessibilityPair[] = []): ValidationIssue[] {
  const issues: ValidationIssue[]=[];
  for (const pair of pairs) {
    try {
      const fg=resolveToken(tokenRoot,pair.foreground), bg=resolveToken(tokenRoot,pair.background);
      if (typeof fg!=='string'||typeof bg!=='string') throw new Error('Contrast tokens must resolve to color strings');
      const ratio=contrastRatio(fg,bg);
      if (ratio+1e-9 < pair.minimum) issues.push({code:pair.id,path:`accessibility.contrast.${pair.id}`,message:`Contrast ${ratio.toFixed(2)}:1 is below ${pair.minimum}:1`,severity:'error'});
    } catch (error) { issues.push({code:'STYLE-A11Y-006',path:`accessibility.contrast.${pair.id}`,message:error instanceof Error?error.message:String(error),severity:'error'}); }
  }
  return issues;
}

export function evaluateSpec(bundle: EvaluationBundle): EvaluationResult {
  const accessibility=isRecord(bundle.accessibility)?bundle.accessibility:{};
  const rules=Array.isArray(accessibility.rules)?accessibility.rules:[];
  const pairs=Array.isArray(accessibility.contrastPairs)?accessibility.contrastPairs:[];
  const knownRuleIds=new Set<string>([...rules,...pairs].filter(isRecord).map(rule=>rule.id).filter((id):id is string=>typeof id==='string'));
  const validPairs=pairs.filter((pair):pair is AccessibilityPair=>isRecord(pair)&&typeof pair.id==='string'&&typeof pair.foreground==='string'&&typeof pair.background==='string'&&typeof pair.minimum==='number');
  const issues=[...validateManifest(bundle.manifest),...validateTokenGraph(bundle.tokens),...validateAccessibility(bundle.accessibility),...validatePatterns(bundle.patterns),...validateComponents(bundle.components,bundle.tokens,knownRuleIds),...validateContrast(bundle.tokens,validPairs)];
  const errors=issues.filter(i=>i.severity==='error').length, warnings=issues.length-errors;
  return {valid:errors===0,issues,metrics:{errors,warnings}};
}
