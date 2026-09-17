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
    if (!isRecord(current) || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

export function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts=path.split('.').filter(Boolean);
  if(parts.length===0)throw new Error('Path cannot be empty');
  if(parts.some(p=>p==='__proto__'||p==='prototype'||p==='constructor'))throw new Error('Unsafe path');
  let current:Record<string,unknown>=root;
  for(const part of parts.slice(0,-1)){
    const next=current[part];
    if(!isRecord(next))throw new Error(`Unknown object path: ${parts.slice(0,parts.indexOf(part)+1).join('.')}`);
    current=next;
  }
  const leaf=parts.at(-1)!;
  if(!(leaf in current))throw new Error(`Unknown path: ${path}`);
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

export function validateTokenGraph(root: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const { path, token } of flattenTokenLeaves(root)) {
    const ref = tokenReference(token.$value);
    if (ref && getPath(root, ref) === undefined) issues.push({ code:'STYLE-TOKEN-001', path, message:`Missing token reference ${ref}`, severity:'error' });
    try { resolveToken(root, path); } catch (error) {
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
  for (const [key, value] of Object.entries(source)) {
    if (isRecord(value) && isRecord(target[key])) mergeObjects(target[key] as Record<string, unknown>, value);
    else target[key] = deepClone(value);
  }
  return target;
}
