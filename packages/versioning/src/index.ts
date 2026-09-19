import { createHash } from 'node:crypto';
import { canonicalize, isRecord } from '../../style-spec/src/index.js';

export interface StyleSnapshot {
  version: string;
  files: Record<string, unknown>;
}

export interface SnapshotIndexEntry { version: string; path: string; sha256: string; sourceCommit: string }

export function verifySnapshot(entry: SnapshotIndexEntry, bytes: Uint8Array): StyleSnapshot {
  if (!/^\d+\.\d+\.\d+$/.test(entry.version) || entry.path !== `${entry.version}-style-spec.json` || !/^[0-9a-f]{64}$/.test(entry.sha256) || !/^[0-9a-f]{40}$/.test(entry.sourceCommit)) throw new Error('Invalid release snapshot metadata');
  const canonicalBytes = Buffer.from(Buffer.from(bytes).toString().replace(/\r\n/g, '\n'));
  if (createHash('sha256').update(canonicalBytes).digest('hex') !== entry.sha256) throw new Error(`Snapshot hash mismatch: ${entry.version}`);
  const snapshot = JSON.parse(canonicalBytes.toString()) as StyleSnapshot;
  if (snapshot.version !== entry.version || !isRecord(snapshot.files) || !isRecord(snapshot.files['manifest.json']) || snapshot.files['manifest.json'].version !== entry.version) throw new Error(`Invalid snapshot contents: ${entry.version}`);
  return snapshot;
}

export interface SpecChange {
  path: string;
  domain: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

export interface VersionComparison {
  fromVersion: string;
  toVersion: string;
  totalChanges: number;
  truncated: boolean;
  summaryByDomain: Record<string, number>;
  changes: SpecChange[];
}

function keyedArray(value: unknown[]): Map<string, unknown> | undefined {
  if (!value.every(item => isRecord(item) && typeof item.id === 'string')) return undefined;
  const entries = value.map(item => [String((item as Record<string, unknown>).id), item] as const);
  if (new Set(entries.map(([id]) => id)).size !== entries.length) return undefined;
  return new Map(entries);
}

function escapePointer(part: string): string { return part.replace(/~/g, '~0').replace(/\//g, '~1'); }

export function compareSnapshots(from: StyleSnapshot, to: StyleSnapshot, maxChanges = 500): VersionComparison {
  if (!Number.isInteger(maxChanges) || maxChanges < 1) throw new Error('maxChanges must be a positive integer');
  const changes: SpecChange[] = [];
  const summaryByDomain: Record<string, number> = Object.create(null) as Record<string, number>;
  let totalChanges = 0;
  const emit = (path: string, domain: string, kind: SpecChange['kind'], before?: unknown, after?: unknown) => {
    totalChanges++;
    summaryByDomain[domain] = (summaryByDomain[domain] ?? 0) + 1;
    if (changes.length < maxChanges) changes.push({ path, domain, kind, ...(kind !== 'added' ? { before } : {}), ...(kind !== 'removed' ? { after } : {}) });
  };
  const walk = (before: unknown, after: unknown, path: string, domain: string, beforeExists: boolean, afterExists: boolean): void => {
    if (!beforeExists) { emit(path, domain, 'added', undefined, after); return; }
    if (!afterExists) { emit(path, domain, 'removed', before); return; }
    if (canonicalize(before) === canonicalize(after)) return;
    if (isRecord(before) && isRecord(after)) {
      for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
        walk(before[key], after[key], `${path}/${escapePointer(key)}`, domain, key in before, key in after);
      }
      return;
    }
    if (Array.isArray(before) && Array.isArray(after)) {
      const oldById = keyedArray(before), newById = keyedArray(after);
      if (oldById && newById) {
        for (const id of [...new Set([...oldById.keys(), ...newById.keys()])].sort()) {
          walk(oldById.get(id), newById.get(id), `${path}/id=${escapePointer(id)}`, domain, oldById.has(id), newById.has(id));
        }
        return;
      }
    }
    emit(path, domain, 'changed', before, after);
  };
  for (const file of [...new Set([...Object.keys(from.files), ...Object.keys(to.files)])].sort()) {
    const domain = file.split('/')[0]!.replace(/\.json$/, '');
    walk(from.files[file], to.files[file], `spec/${file}#`, domain, file in from.files, file in to.files);
  }
  return { fromVersion: from.version, toVersion: to.version, totalChanges, truncated: totalChanges > changes.length, summaryByDomain, changes };
}
