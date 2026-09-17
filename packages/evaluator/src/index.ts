import { getPath, isRecord, resolveToken, tokenReference, validateTokenGraph, type ValidationIssue } from '../../style-spec/src/index.js';

export interface AccessibilityPair { id: string; foreground: string; background: string; minimum: number; }
export interface EvaluationBundle { manifest: unknown; tokens: unknown; components: unknown[]; accessibility: { contrastPairs?: AccessibilityPair[] }; }
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

export function validateComponents(components: unknown[], tokenRoot: unknown): ValidationIssue[] {
  const issues: ValidationIssue[]=[]; const required=['default','hover','focus','disabled'];
  for (const raw of components) {
    if (!isRecord(raw) || typeof raw.id!=='string') { issues.push({code:'STYLE-COMP-001',path:'components',message:'Component needs a string id',severity:'error'}); continue; }
    const id=raw.id; const states=Array.isArray(raw.states)?raw.states:[];
    for (const state of required) if (!states.includes(state)) issues.push({code:'STYLE-COMP-002',path:`components.${id}.states`,message:`Missing state ${state}`,severity:'error'});
    const a11y=isRecord(raw.accessibility)?raw.accessibility:{};
    if (a11y.focusVisible!==true) issues.push({code:'STYLE-A11Y-001',path:`components.${id}.accessibility.focusVisible`,message:'Interactive component must define visible focus',severity:'error'});
    const tokens=isRecord(raw.tokens)?raw.tokens:{};
    for (const [name,val] of Object.entries(tokens)) {
      const ref=tokenReference(val); if (!ref) issues.push({code:'STYLE-TOKEN-003',path:`components.${id}.tokens.${name}`,message:'Component token assignments must be token references',severity:'warning'});
      else if (getPath(tokenRoot, ref)===undefined) issues.push({code:'STYLE-TOKEN-001',path:`components.${id}.tokens.${name}`,message:`Unknown token ${ref}`,severity:'error'});
    }
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
  const issues=[...validateManifest(bundle.manifest),...validateTokenGraph(bundle.tokens),...validateComponents(bundle.components,bundle.tokens),...validateContrast(bundle.tokens,bundle.accessibility.contrastPairs)];
  const errors=issues.filter(i=>i.severity==='error').length, warnings=issues.length-errors;
  return {valid:errors===0,issues,metrics:{errors,warnings}};
}
