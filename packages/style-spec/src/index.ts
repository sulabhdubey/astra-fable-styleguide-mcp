export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export interface ValidationIssue { code: string; path: string; message: string; severity: 'error' | 'warning'; }
export interface TokenLeaf { $type?: string; $value: JsonValue; }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTokenLeaf(value: unknown): value is TokenLeaf {
  return isRecord(value) && '$value' in value;
}

export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (isRecord(value) || Array.isArray(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      if ((isRecord(child) || Array.isArray(child)) && !Object.isFrozen(child)) deepFreeze(child);
    }
  }
  return value as Readonly<T>;
}

export function getPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const part of path.split('.')) {
    if (!isRecord(current) || !Object.hasOwn(current,part)) return undefined;
    current = current[part];
  }
  return current;
}

export function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts=path.split('.');
  if(parts.length===0)throw new Error('Path cannot be empty');
  if(parts.some(part=>!part))throw new Error('Path contains an empty segment');
  if(parts.some(p=>p==='__proto__'||p==='prototype'||p==='constructor'))throw new Error('Unsafe path');
  let current:Record<string,unknown>=root;
  for(const part of parts.slice(0,-1)){
    if(!Object.hasOwn(current,part))throw new Error(`Unknown object path: ${path}`);
    const next=current[part];
    if(!isRecord(next))throw new Error(`Unknown object path: ${parts.slice(0,parts.indexOf(part)+1).join('.')}`);
    current=next;
  }
  const leaf=parts.at(-1)!;
  if(!Object.hasOwn(current,leaf))throw new Error(`Unknown path: ${path}`);
  current[leaf]=deepClone(value);
}

export function addPath(root: Record<string,unknown>,path:string,value:unknown):void{
  const parts=path.split('.');
  if(parts.length<2)throw new Error('Addition requires an existing parent path');
  if(parts.some(part=>!part))throw new Error('Path contains an empty segment');
  if(parts.some(part=>part==='__proto__'||part==='prototype'||part==='constructor'))throw new Error('Unsafe path');
  let current:Record<string,unknown>=root;
  for(const part of parts.slice(0,-1)){
    if(!Object.hasOwn(current,part))throw new Error(`Unknown object path: ${path}`);
    const next=current[part];
    if(!isRecord(next))throw new Error(`Unknown object path: ${path}`);
    current=next;
  }
  const leaf=parts.at(-1)!;
  if(Object.hasOwn(current,leaf))throw new Error(`Path already exists: ${path}`);
  current[leaf]=deepClone(value);
}

export function tokenReference(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^\{([A-Za-z0-9_.-]+)\}$/.exec(value.trim());
  return m?.[1] ?? null;
}

export function flattenTokenLeaves(root: unknown, prefix = ''): Array<{ path: string; token: TokenLeaf }> {
  const out: Array<{ path: string; token: TokenLeaf }> = [];
  if (!isRecord(root)) return out;
  for (const [key, value] of Object.entries(root)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isTokenLeaf(value)) out.push({ path, token: value });
    else if (isRecord(value)) out.push(...flattenTokenLeaves(value, path));
  }
  return out;
}

export function resolveToken(root: unknown, path: string, stack: string[] = []): JsonValue {
  if (stack.includes(path)) throw new Error(`Circular token reference: ${[...stack, path].join(' -> ')}`);
  const raw = getPath(root, path);
  if (!isTokenLeaf(raw)) throw new Error(`Unknown token: ${path}`);
  const ref = tokenReference(raw.$value);
  if (!ref) return raw.$value;
  return resolveToken(root, ref, [...stack, path]);
}

function isShadowValue(value:JsonValue):boolean{
  if(typeof value!=='string')return false;
  if(value==='none')return true;
  const match=/^(?:inset\s+)?(.+?)\s+(#[0-9a-f]{6}|rgba?\([^)]+\))$/i.exec(value.trim());
  if(!match)return false;
  const lengths=match[1]!.split(/\s+/);
  if(lengths.length<2||lengths.length>4||lengths.some(length=>!/^-(?:\d+|\d*\.\d+)(?:px|rem|em)$|^(?:0|(?:\d+|\d*\.\d+)(?:px|rem|em))$/.test(length)))return false;
  if(lengths.length>=3&&Number.parseFloat(lengths[2]!)<0)return false;
  const color=match[2]!;
  if(color.startsWith('#'))return true;
  const rgb=/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(\d*\.\d+|\d+))?\s*\)$/i.exec(color);
  if(!rgb||rgb.slice(1,4).some(channel=>Number(channel)>255))return false;
  const hasAlpha=rgb[4]!==undefined;
  return /^rgba\(/i.test(color)===hasAlpha&&(!hasAlpha||(Number(rgb[4])>=0&&Number(rgb[4])<=1));
}

function valueMatchesType(type:string,value:JsonValue):boolean{
  if(type==='number')return typeof value==='number'&&Number.isFinite(value);
  if(type==='cubicBezier')return Array.isArray(value)&&value.length===4&&value.every(item=>typeof item==='number'&&Number.isFinite(item));
  if(type==='dimension')return typeof value==='string'&&/^-?(?:\d+|\d*\.\d+)(?:px|rem|em|%)$/.test(value);
  if(type==='duration')return typeof value==='string'&&/^-?(?:\d+|\d*\.\d+)(?:ms|s)$/.test(value);
  if(type==='color')return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
  if(type==='shadow')return isShadowValue(value);
  if(['fontFamily','string'].includes(type))return typeof value==='string'&&value.trim().length>0;
  return false;
}

export function validateTokenGraph(root: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const { path, token } of flattenTokenLeaves(root)) {
    const ref = tokenReference(token.$value);
    if (ref && getPath(root, ref) === undefined) issues.push({ code:'STYLE-TOKEN-001', path, message:`Missing token reference ${ref}`, severity:'error' });
    try {
      const resolved=resolveToken(root,path);
      if(typeof token.$type==='string'&&!valueMatchesType(token.$type,resolved))issues.push({code:'STYLE-TOKEN-004',path,message:`Resolved value does not match declared token type ${token.$type}`,severity:'error'});
    } catch (error) {
      issues.push({ code:'STYLE-TOKEN-002', path, message:error instanceof Error ? error.message : String(error), severity:'error' });
    }
  }
  return dedupeIssues(issues);
}

export function dedupeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter(i => { const k = `${i.code}|${i.path}|${i.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function mergeObjects(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const pending: unknown[] = [source];
  while (pending.length) {
    const current = pending.pop();
    if (isRecord(current)) {
      for (const [key, value] of Object.entries(current)) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error(`Unsafe object key: ${key}`);
        pending.push(value);
      }
    } else if (Array.isArray(current)) for (const value of current) pending.push(value);
  }
  const merge = (into: Record<string, unknown>, from: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(from)) {
      if (Object.hasOwn(into, key) && isRecord(value) && isRecord(into[key])) merge(into[key] as Record<string, unknown>, value);
      else into[key] = deepClone(value);
    }
  };
  merge(target, source);
  return target;
}
