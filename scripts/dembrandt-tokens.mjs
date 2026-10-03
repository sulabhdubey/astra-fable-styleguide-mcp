const supportedSchemas = new Set(['1.17.0', '1.18.0']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const color = value => typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value);
const tokenName = value => typeof value === 'string' && value.length <= 128 && /^--[A-Za-z_][A-Za-z0-9_-]*$/.test(value);
const viewport = value => object(value) && ['width', 'height'].every(key => Number.isInteger(value[key]) && value[key] >= 1 && value[key] <= 8192);
const colorStage = value => /^(colors?|tokens|cssVariables)$/i.test(value);
const claimBoundary = 'Export baseline drift for declared color tokens in the selected static scope. A match does not prove component use, interaction states, accessibility or constitution compliance.';

/** Read only the supported color contract; imported observations never become canonical rules. */
export function importDembrandtExport(value) {
  const meta = object(value?.meta) ? value.meta : {};
  const issues = [], warnings = [], items = [];
  if (!supportedSchemas.has(meta.schemaVersion)) issues.push('unsupported_schema');
  if (typeof meta.snapshotId !== 'string' || !meta.snapshotId.trim() || meta.snapshotId.length > 128 || /[\u0000-\u001f\u007f]/.test(meta.snapshotId)) issues.push('missing_or_invalid_snapshot_id');
  if (!viewport(meta.viewport)) issues.push('missing_or_invalid_viewport');
  if (!Number.isInteger(meta.httpStatus) || meta.httpStatus < 200 || meta.httpStatus >= 300) issues.push('unsuccessful_or_unknown_extraction_http_status');
  const flags = object(meta.flags) ? meta.flags : {};
  if ((meta.flags !== undefined && !object(meta.flags)) ||
      ['darkMode', 'mobile', 'stealth'].some(key => flags[key] !== undefined && typeof flags[key] !== 'boolean') ||
      flags.mobile === true || flags.stealth === true ||
      (flags.browser !== undefined && flags.browser !== 'chromium') ||
      (flags.locale !== undefined && flags.locale !== 'en-US') ||
      ['userAgent', 'timezone', 'acceptLanguage'].some(key => flags[key] !== undefined)) issues.push('unsupported_extraction_profile');
  if (meta.crawl !== undefined && (!object(meta.crawl) || meta.crawl.pagesFound !== 1 || (meta.crawl.pages !== undefined && (!Array.isArray(meta.crawl.pages) || meta.crawl.pages.length !== 1)))) issues.push('merged_or_unknown_page_scope');
  if (meta.degraded !== undefined && (!Array.isArray(meta.degraded) || meta.degraded.some(stage => typeof stage !== 'string'))) issues.push('invalid_degraded_metadata');
  else for (const stage of meta.degraded ?? []) (colorStage(stage) ? issues : warnings).push(colorStage(stage) ? 'color_extraction_degraded' : 'other_extraction_category_degraded');
  if (meta.errors !== undefined && (!Array.isArray(meta.errors) || meta.errors.some(error => !object(error) || typeof error.stage !== 'string'))) issues.push('invalid_error_metadata');
  else for (const error of meta.errors ?? []) (colorStage(error.stage) ? issues : warnings).push(colorStage(error.stage) ? 'color_extraction_failed' : 'other_extraction_category_failed');
  if (meta.fontsReady === false) warnings.push('fonts_not_ready_color_scope_only');
  if (meta.timeouts !== undefined && (!Array.isArray(meta.timeouts) || meta.timeouts.some(wait => typeof wait !== 'string'))) issues.push('invalid_timeout_metadata');
  else if (meta.timeouts?.length) issues.push('extraction_wait_timed_out');
  const palette = value?.colors?.palette;
  if (!Array.isArray(palette) || !palette.length || palette.length > 500) issues.push('missing_empty_or_oversized_palette');
  else {
    const declared = new Map();
    for (const [paletteIndex, entry] of palette.entries()) {
      if (!object(entry) || !color(entry.normalized) || (entry.tokens !== undefined && (!Array.isArray(entry.tokens) || entry.tokens.length > 50 || entry.tokens.some(token => !tokenName(token))))) {
        items.push({ paletteIndex, token: null, expected: null, issue: 'invalid_or_unsupported_palette_entry' }); continue;
      }
      const expected = entry.normalized.toLowerCase();
      if (!entry.tokens?.length) items.push({ paletteIndex, token: null, expected, issue: null });
      else for (const token of new Set(entry.tokens)) {
        const previous = declared.get(token);
        if (previous) { if (previous.expected !== expected) previous.issue = 'conflicting_token_baselines'; continue; }
        const variable = value.colors.cssVariables?.[token];
        const contradictory = object(variable) && variable.hex !== undefined && (!color(variable.hex) || variable.hex.toLowerCase() !== expected);
        const item = { paletteIndex, token, expected, issue: contradictory ? 'conflicting_declared_color_evidence' : null };
        declared.set(token, item); items.push(item);
      }
      if (items.length > 1000) { issues.push('too_many_token_checks'); break; }
    }
  }
  return { schemaVersion: supportedSchemas.has(meta.schemaVersion) ? meta.schemaVersion : null,
    snapshotId: typeof meta.snapshotId === 'string' && meta.snapshotId.length <= 128 ? meta.snapshotId : null,
    viewport: viewport(meta.viewport) ? { width: meta.viewport.width, height: meta.viewport.height } : null,
    colorScheme: flags.darkMode === true ? 'dark' : 'light',
    items, issues: [...new Set(issues)], warnings: [...new Set(warnings)] };
}

export function evaluateTokenObservations(baseline, observation) {
  const issues = [...baseline.issues];
  if (!observation) issues.push('live_observation_unavailable');
  else {
    if (!viewport(observation.viewport) || !baseline.viewport || observation.viewport.width !== baseline.viewport.width || observation.viewport.height !== baseline.viewport.height) issues.push('viewport_mismatch');
    if (!['body', 'root'].includes(observation.scope)) issues.push('invalid_token_scope');
    issues.push(...(observation.issues ?? []));
  }
  const checks = baseline.items.map(item => {
    const observed = observation?.values?.find(value => value.token === item.token);
    const rgba = observed?.rgba;
    const supported = Array.isArray(rgba) && rgba.length === 4 && rgba.every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255) && rgba[3] === 255;
    const normalized = supported ? '#' + rgba.slice(0, 3).map(channel => channel.toString(16).padStart(2, '0')).join('') : null;
    const status = issues.length || item.issue ? 'incomplete' : !item.token ? 'unverified' : !supported ? 'incomplete' : normalized === item.expected ? 'match' : 'mismatch';
    const reason = issues.length ? issues[0] : item.issue ?? (!item.token ? 'no_declared_token' : !observed?.raw ? 'token_missing' : !supported ? 'unsupported_or_transparent_color' : 'opaque_srgb_comparison');
    return { ...item, status, reason, observed: normalized, raw: typeof observed?.raw === 'string' ? observed.raw.slice(0, 512) : null };
  });
  const status = issues.length || !checks.length || checks.some(check => check.status === 'incomplete') ? 'incomplete' : checks.some(check => check.status === 'mismatch') ? 'mismatch' : checks.some(check => check.status === 'unverified') ? 'unverified' : 'match';
  return { reportVersion: 1, integration: 'dembrandt-declared-colors', schemaVersion: baseline.schemaVersion, snapshotId: baseline.snapshotId,
    status, exitCode: status === 'match' ? 0 : status === 'mismatch' ? 1 : 2, viewport: baseline.viewport, scope: observation?.scope ?? null,
    claimBoundary, checks, issues: [...new Set(issues)], warnings: baseline.warnings };
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export function formatTokenReport(report, format = 'text') {
  if (format === 'json') return JSON.stringify(report, null, 2);
  if (format === 'text') return [`Dembrandt token comparison: ${report.status}`, `Snapshot: ${report.snapshotId ?? 'unavailable'} | schema: ${report.schemaVersion ?? 'unsupported'} | scope: ${report.scope ?? 'unavailable'}`,
    ...report.checks.map(check => `${check.status.padEnd(10)} ${check.token ?? '(observed color)'}: expected ${check.expected ?? '?'}; observed ${check.observed ?? '?'} (${check.reason})`),
    ...report.issues.map(issue => `Incomplete: ${issue}`), ...report.warnings.map(warning => `Warning: ${warning}`), report.claimBoundary].join('\n');
  if (format !== 'html') throw new Error('Token report format must be text, json or html');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Declared color token comparison</title><style>
body{margin:0;background:#f5f6fa;color:#18223b;font:16px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:32px}h1{line-height:1.2}header{border-top:5px solid #5364e8;padding-top:20px}code,td{font-family:ui-monospace,monospace}section{overflow:auto;background:white;border:1px solid #c9cfdf;border-radius:8px;padding:16px;margin:24px 0}table{border-collapse:collapse;width:100%;text-align:left}th,td{padding:12px;border-bottom:1px solid #dce0eb;vertical-align:top}dt{font-weight:700}dd{margin:0 0 12px}li{overflow-wrap:anywhere}p{overflow-wrap:anywhere}.status{font-weight:700;color:#293cb6}footer{font-size:14px;color:#44516b}
</style></head><body><main><header><p>Style Constitution / experimental import</p><h1>Declared color token comparison</h1><p class="status">${escape(report.status)}</p><p>Snapshot <code>${escape(report.snapshotId)}</code> · Schema ${escape(report.schemaVersion)} · Scope ${escape(report.scope)} · Viewport ${escape(report.viewport?.width)} × ${escape(report.viewport?.height)}</p></header>
<section><table><thead><tr><th>Token</th><th>Export</th><th>Rendered</th><th>Result / reason</th></tr></thead><tbody>${report.checks.map(check => `<tr><td>${escape(check.token ?? '(observed color)')}</td><td>${escape(check.expected)}</td><td>${escape(check.observed)}</td><td>${escape(check.status)}<br>${escape(check.reason)}</td></tr>`).join('')}</tbody></table></section>
<ul>${[...report.issues, ...report.warnings].map(value => `<li>${escape(value)}</li>`).join('')}</ul><dl><dt>match</dt><dd>The declared token equals its exported opaque sRGB color in this scope.</dd><dt>mismatch</dt><dd>A comparable declared token differs from the exported baseline.</dd><dt>unverified</dt><dd>The palette color has no declared token to check.</dd><dt>incomplete</dt><dd>Required extraction or browser evidence is missing or unsupported.</dd></dl><footer><p>${escape(report.claimBoundary)}</p><p>Export SHA-256: ${escape(report.evidence?.exportSha256 ?? 'unavailable')}<br>Page SHA-256: ${escape(report.evidence?.pageSha256 ?? 'unavailable')}</p></footer></main></body></html>`;
}
