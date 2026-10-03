/* global document, getComputedStyle, CSS */
import { readFile, stat, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { importDembrandtExport, evaluateTokenObservations, formatTokenReport } from './dembrandt-tokens.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function inputBytes(path, limit) {
  const info = await stat(path);
  if (!info.isFile() || info.size > limit) throw new Error('Unsupported token input size or file type');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error('Token input grew beyond its limit');
  return bytes;
}
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

/** Execute only the caller-selected local HTML snapshot, with all network requests refused. */
export async function runDembrandtCheck(exportPath, pagePath, { scope = 'body' } = {}) {
  if (!['body', 'root'].includes(scope)) throw new Error('Token scope must be body or root');
  const exportBytes = await inputBytes(exportPath, 2_000_000), pageBytes = await inputBytes(pagePath, 1_000_000);
  const baseline = importDembrandtExport(JSON.parse(decode(exportBytes)));
  const evidence = { exportSha256: hash(exportBytes), pageSha256: hash(pageBytes), rendering: 'caller-selected self-contained HTML; network disabled', colorComparison: 'opaque 8-bit sRGB', state: 'static document', colorScheme: baseline.colorScheme };
  if (baseline.issues.length) return { ...evaluateTokenObservations(baseline, null), evidence };
  const { chromium } = await import('playwright');
  let browser;
  try { browser = await chromium.launch({ headless: true, timeout: 15000 }); }
  catch { return { ...evaluateTokenObservations(baseline, { scope, viewport: baseline.viewport, values: [], issues: ['browser_unavailable'] }), evidence }; }
  const issues = [];
  let observation;
  try {
    const context = await browser.newContext({ viewport: baseline.viewport, serviceWorkers: 'block', colorScheme: baseline.colorScheme, locale: 'en-US', deviceScaleFactor: 1 });
    const origin = 'http://127.0.0.1:4173/';
    let mainDocumentServed = false;
    await context.route('**/*', async route => {
      const request = route.request();
      if (request.url() === origin && request.method() === 'GET' && request.isNavigationRequest() && !mainDocumentServed) {
        mainDocumentServed = true;
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageBytes,
          headers: { 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'" } });
      } else { issues.push('resource_or_navigation_blocked'); await route.abort(); }
    });
    await context.addInitScript(() => {
      globalThis.__styleTokenPolicyViolation = false;
      document.addEventListener('securitypolicyviolation', () => { globalThis.__styleTokenPolicyViolation = true; });
    });
    const page = await context.newPage();
    page.on('pageerror', () => issues.push('page_script_error'));
    page.on('popup', async popup => { issues.push('popup_blocked'); await popup.close(); });
    page.on('websocket', () => issues.push('websocket_blocked'));
    try {
      await page.goto(origin, { waitUntil: 'load', timeout: 10000 });
      await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 3000 });
      observation = await page.evaluate(({ scope, tokens }) => {
        const element = scope === 'root' ? document.documentElement : document.body;
        const style = element ? getComputedStyle(element) : null;
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const values = tokens.map(token => {
          const raw = style?.getPropertyValue(token).trim() ?? '';
          if (!ctx || !raw || raw.length > 512 || /\b(currentcolor|inherit|initial|unset|revert|revert-layer|var|env|light-dark)\b/i.test(raw) || !CSS.supports('color', raw)) return { token, raw: raw.slice(0, 512), rgba: null };
          // Canvas serializes nearly opaque alpha as 1. Require explicitly opaque alpha syntax.
          const slashes = raw.match(/\//g)?.length ?? 0;
          const opaqueSlashes = raw.match(/\/\s*(?:1(?:\.0+)?|100(?:\.0+)?%)\s*\)/g)?.length ?? 0;
          const nestedFunctions = (raw.match(/\b[a-z][a-z-]*\s*\(/gi)?.length ?? 0) > 1;
          const legacyFunctions = [...raw.matchAll(/\b(?:rgba?|hsla?)\(([^()]*)\)/gi)];
          const unsupportedLegacyAlpha = legacyFunctions.some(match => {
            const parts = match[1].split(',');
            return parts.length === 4 && !/^\s*(?:1(?:\.0+)?|100(?:\.0+)?%)\s*$/.test(parts[3]);
          });
          // Restrict mixes to flat opaque color names/hex; nested mixes can hide fractional alpha.
          const mix = /^color-mix\(\s*in\s+srgb\s*,\s*(?:#[\da-f]{3,8}|[a-z]+)(?:\s+([\d.]+)%)?\s*,\s*(?:#[\da-f]{3,8}|[a-z]+)(?:\s+([\d.]+)%)?\s*\)$/i.exec(raw);
          const unsupportedMix = /\bcolor-mix\(/i.test(raw) && (!mix || (mix[1] !== undefined && mix[2] !== undefined && Number(mix[1]) + Number(mix[2]) < 100));
          const alphaHex = [...raw.matchAll(/#([\da-f]+)\b/gi)].some(match => (match[1].length === 4 && !/f$/i.test(match[1])) || (match[1].length === 8 && !/ff$/i.test(match[1])));
          if (slashes !== opaqueSlashes || nestedFunctions || unsupportedLegacyAlpha || unsupportedMix || alphaHex || /\btransparent\b/i.test(raw)) return { token, raw, rgba: null };
          // Canvas silently ignores some CSS colors. Two initial values detect a refused assignment.
          ctx.fillStyle = '#ff0000'; ctx.fillStyle = raw; const first = ctx.fillStyle;
          ctx.fillStyle = '#0000ff'; ctx.fillStyle = raw; const parsed = ctx.fillStyle;
          const alpha = /^rgba\(/.test(parsed) ? /,\s*([\d.]+)\)$/.exec(parsed)?.[1] : /\/\s*([\d.]+)%?\)$/.exec(parsed)?.[1];
          if (first !== parsed || (alpha !== undefined && Number(alpha) !== 1)) return { token, raw, rgba: null };
          ctx.clearRect(0, 0, 1, 1); ctx.fillRect(0, 0, 1, 1);
          return { token, raw, rgba: Array.from(ctx.getImageData(0, 0, 1, 1).data) };
        });
        return { scope, viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight }, values,
          issues: [!element ? 'scope_element_missing' : null, globalThis.__styleTokenPolicyViolation ? 'page_policy_violation' : null].filter(Boolean) };
      }, { scope, tokens: [...new Set(baseline.items.map(item => item.token).filter(Boolean))] });
    } catch { issues.push('browser_observation_failed_or_timed_out'); }
    if (observation) observation.issues.push(...issues);
    else observation = { scope, viewport: baseline.viewport, values: [], issues };
    if (hash(await inputBytes(exportPath, 2_000_000)) !== evidence.exportSha256 || hash(await inputBytes(pagePath, 1_000_000)) !== evidence.pageSha256) observation.issues.push('input_changed_during_check');
    return { ...evaluateTokenObservations(baseline, observation), evidence };
  } finally { await browser.close(); }
}

export async function tokenCheckCommand(args) {
  const [command, exportPath, pagePath, ...options] = args;
  if (command !== 'check' || !exportPath || !pagePath) throw new Error('Usage: stylecon tokens check <export.json> <self-contained-page.html> [--scope body|root] [--format text|json|html] [--output new-private-file]');
  let scope = 'body', format = 'text', output;
  const seen = new Set();
  for (let index = 0; index < options.length; index += 2) {
    const option = options[index], value = options[index + 1];
    if (!['--scope', '--format', '--output'].includes(option) || seen.has(option)) throw new Error('Unknown or duplicate token option');
    if (!value || value.startsWith('--')) throw new Error('Missing token option value');
    seen.add(option);
    if (option === '--scope') scope = value;
    else if (option === '--format') format = value;
    else output = resolve(value);
  }
  if (!['text', 'json', 'html'].includes(format)) throw new Error('Token report format must be text, json or html');
  if (output) {
    const root = dirname(await realpath(resolve(pagePath))), parent = await realpath(dirname(output)), rel = relative(root, parent);
    if (!rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))) throw new Error('Save token reports outside the rendered page directory');
    if (output === await realpath(resolve(exportPath))) throw new Error('Report cannot replace the imported export');
  }
  const report = await runDembrandtCheck(resolve(exportPath), resolve(pagePath), { scope });
  const rendered = formatTokenReport(report, format) + '\n';
  if (output) await writeFile(output, rendered, { flag: 'wx', mode: 0o600 });
  else process.stdout.write(rendered);
  return report.exitCode;
}
