import { flattenTokenLeaves, resolveToken } from '../../style-spec/src/index.js';

export interface ComplianceViolation {
  ruleId: 'STYLE-COLOR-001' | 'STYLE-SPACE-001';
  message: string;
  match: string;
  line: number;
  column: number;
}

export interface ComplianceResult {
  status: 'pass' | 'fail' | 'not_checked';
  compliant: boolean;
  truncated: boolean;
  violations: ComplianceViolation[];
  warnings: string[];
  suggestedFixes: string[];
  checksPerformed: string[];
  limitations: string[];
}

interface SourceSpan { text: string; offset: number }

function sourceSpans(input: string): SourceSpan[] {
  const looksLikeHtml = /^\s*(?:<!doctype|<[a-z][\w-]*(?:\s|>))/i.test(input) || /<style\b/i.test(input);
  if (!looksLikeHtml) return [{ text: input, offset: 0 }];
  const spans: SourceSpan[] = [];
  for (const match of input.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    const body = match[1];
    if (body !== undefined) spans.push({ text: body, offset: match.index + match[0].indexOf(body) });
  }
  for (const match of input.matchAll(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    const body = match[2];
    if (body !== undefined) spans.push({ text: body, offset: match.index + match[0].indexOf(body) });
  }
  return spans;
}

// Preserve offsets so diagnostics still refer to the original supplied source.
function maskCommentsAndStrings(source: string): string {
  let out = '';
  let state: 'code' | 'comment' | 'string' = 'code';
  let quote = '';
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    const next = source[i + 1];
    if (state === 'code' && char === '/' && next === '*') { state = 'comment'; out += '  '; i++; continue; }
    if (state === 'comment' && char === '*' && next === '/') { state = 'code'; out += '  '; i++; continue; }
    if (state === 'code' && (char === '"' || char === "'")) { state = 'string'; quote = char; out += ' '; continue; }
    if (state === 'string' && char === '\\' && next !== undefined) { out += next === '\n' ? ' \n' : '  '; i++; continue; }
    if (state === 'string' && char === quote) { state = 'code'; out += ' '; continue; }
    out += state === 'code' || char === '\n' ? char : ' ';
  }
  return out;
}

function lineStarts(input: string): number[] {
  const starts = [0];
  for (let i = 0; i < input.length; i++) if (input[i] === '\n') starts.push(i + 1);
  return starts;
}

function position(starts: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: offset - starts[low]! + 1 };
}

export function checkStyleCompliance(input: string, tokens: Record<string, unknown>): ComplianceResult {
  const maxFindings = 200;
  const starts = lineStarts(input);
  const allowed = new Set<string>();
  for (const { path } of flattenTokenLeaves(tokens)) {
    try {
      const value = resolveToken(tokens, path);
      if (typeof value === 'string') allowed.add(value.toLowerCase());
    } catch { /* Canonical validation reports invalid references separately. */ }
  }
  const spans = sourceSpans(input);
  const violations: ComplianceViolation[] = [];
  let truncated = false;
  const seen = new Set<string>();
  for (const span of spans) {
    const source = maskCommentsAndStrings(span.text);
    const emit = (ruleId: ComplianceViolation['ruleId'], message: string, match: RegExpExecArray) => {
      if (violations.length >= maxFindings) { truncated = true; return; }
      const offset = span.offset + match.index;
      const key = `${ruleId}:${offset}`;
      if (seen.has(key)) return;
      seen.add(key);
      violations.push({ ruleId, message, match: match[0], ...position(starts, offset) });
    };
    for (const match of source.matchAll(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/g)) {
      if (!allowed.has(match[0]!.toLowerCase())) emit('STYLE-COLOR-001', 'Arbitrary hex color is outside the canonical tokens', match);
    }
    for (const match of source.matchAll(/(?<![\w.-])\d+(?:\.\d+)?px\b/g)) {
      if (!allowed.has(match[0]!.toLowerCase())) emit('STYLE-SPACE-001', 'Raw pixel value is not present in the approved token set', match);
    }
  }
  violations.sort((a, b) => a.line - b.line || a.column - b.column || a.ruleId.localeCompare(b.ruleId));
  const checked = spans.some(span => span.text.trim().length > 0);
  const warnings = checked ? [] : ['No CSS style block or inline style attribute was found; no style declarations were checked.'];
  if (truncated) warnings.push(`Findings were capped at ${maxFindings}; additional violations may exist.`);
  return {
    status: !checked ? 'not_checked' : violations.length ? 'fail' : 'pass',
    compliant: checked && violations.length === 0,
    truncated,
    violations,
    warnings,
    suggestedFixes: [...new Set(violations.map(v => `Replace ${v.match} with an approved semantic token.`))],
    checksPerformed: ['Canonical hex color literals', 'Pixel literals against resolved token values'],
    limitations: ['Textual CSS scan only; does not parse all CSS, JavaScript style objects, visual output, interaction states, contrast, or accessibility.'],
  };
}
