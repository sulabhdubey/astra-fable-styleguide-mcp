import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';

export type AuditEvent =
  | { type: 'proposal_created'; proposalIdHash: string; actor: 'astra' | 'fable'; changeCount: number }
  | { type: 'run_recorded'; runId: string; source: 'manual' | 'agent-consensus'; status: string; rounds: number; proposalIdHashes: string[]; conflictCount: number; evaluationErrorCount: number; candidateHash?: string }
  | { type: 'candidate_approved'; candidateHash: string; actor: 'astra' | 'fable' }
  | { type: 'candidate_released'; candidateHash: string };

interface AuditRecord { sequence: number; previousHash: string; recordedAt: string; event: AuditEvent; hash: string }
const GENESIS = '0'.repeat(64);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const auditIdentifier = (value: string) => digest(value);
const recordHash = (record: Omit<AuditRecord, 'hash'>) => digest(JSON.stringify(record));

/** A single-process, append-only local evidence file. It does not restore service state. */
export class AuditLedger {
  private readonly path: string;
  private count = 0;
  private head = GENESIS;
  private byteLength = 0;

  constructor(filePath: string) {
    this.path = resolve(filePath);
    if (!existsSync(this.path)) {
      const fd = openSync(this.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      try { fsyncSync(fd); } finally { closeSync(fd); }
    }
    if (!lstatSync(this.path).isFile()) throw new Error('Audit integrity error: path is not a regular file');
    const raw = readFileSync(this.path, 'utf8');
    this.byteLength = Buffer.byteLength(raw);
    if (raw && !raw.endsWith('\n')) throw new Error('Audit integrity error: incomplete final record');
    const lines = raw ? raw.slice(0, -1).split('\n') : [];
    for (const line of lines) {
      if (!line) throw new Error('Audit integrity error: blank record');
      let record: AuditRecord;
      try { record = JSON.parse(line) as AuditRecord; }
      catch { throw new Error('Audit integrity error: invalid JSON record'); }
      if (!record || typeof record !== 'object') throw new Error('Audit integrity error: invalid record');
      const { hash, ...body } = record;
      if (record.sequence !== this.count + 1 || record.previousHash !== this.head ||
        typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || hash !== recordHash(body)) throw new Error('Audit integrity error: broken hash chain');
      this.count++;
      this.head = record.hash;
    }
  }

  record(event: AuditEvent): void {
    const base = { sequence: this.count + 1, previousHash: this.head, recordedAt: new Date().toISOString(), event };
    const next: AuditRecord = { ...base, hash: recordHash(base) };
    const bytes = Buffer.from(`${JSON.stringify(next)}\n`);
    const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0);
    const fd = openSync(this.path, flags, 0o600);
    try {
      const file = fstatSync(fd);
      if (!file.isFile() || file.size !== this.byteLength) throw new Error('Audit integrity error: file changed outside this process');
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    this.count++;
    this.head = next.hash;
    this.byteLength += bytes.length;
  }

  status() { return { durable: true, eventCount: this.count, headHash: this.head }; }
}
