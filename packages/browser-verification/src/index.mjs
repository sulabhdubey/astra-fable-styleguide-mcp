import { createHash } from 'node:crypto';

export function createContract({ button, dialog, rules }) {
  const minimum = /^(\d+(?:\.\d+)?)px$/.exec(button.accessibility.minimumTarget);
  const ringRule = rules.rules.find(rule => rule.id === 'STYLE-A11Y-010');
  const contrast = /at least (\d+(?:\.\d+)?):1/.exec(ringRule?.requirement ?? '');
  const required = ['STYLE-A11Y-001', 'STYLE-A11Y-009', 'STYLE-A11Y-010', 'STYLE-A11Y-011', 'STYLE-A11Y-012', 'STYLE-A11Y-013'];
  if (!minimum || !contrast || required.some(id => !rules.rules.some(rule => rule.id === id)) ||
      dialog.accessibility.accessibleNameSource !== 'visible-title' ||
      dialog.accessibility.initialFocus !== 'inside-dialog' || dialog.accessibility.focusTrap !== true ||
      dialog.accessibility.returnFocusToTrigger !== true || dialog.accessibility.escapeDismissal !== 'when-allowed') {
    throw new Error('Unsupported canonical browser contract; review the verifier before using changed rules');
  }
  return Object.freeze({ minimumTarget: Number(minimum[1]), minimumFocusContrast: Number(contrast[1]),
    specSha256: createHash('sha256').update(JSON.stringify({ button, dialog, rules })).digest('hex'),
    specHashScope: 'JSON.stringify({button,dialog,rules}) of the three canonical documents' });
}

function rgb(color) {
  const match = /^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*(1(?:\.0+)?))?\)$/.exec(color ?? '');
  if (!match) return null;
  const channels = match.slice(1, 4).map(Number);
  return channels.every(x => x >= 0 && x <= 255) ? channels : null;
}
function luminance(channels) {
  return channels.map(x => { const s = x / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
}

/** Evaluate recorded observations, not source text. This report covers configured elements only. */
export function evaluateObservations(contract, observed, identity = {}) {
  if (identity.artifactSha256 !== undefined && !/^[a-f0-9]{64}$/.test(identity.artifactSha256)) throw new Error('Invalid artifact SHA-256');
  const checks = [];
  const add = (check, ruleId, status, observedValue, fix, target = 'dialog') => checks.push({ check, ruleId, target, status, observed: observedValue, fix });
  const boolean = (value) => value === true ? 'pass' : value === false ? 'fail' : 'not_checked';
  for (const button of observed.buttons ?? []) {
    const measured = button.visible === true && Number.isFinite(button.width) && Number.isFinite(button.height);
    add('target', 'STYLE-A11Y-009', !measured ? 'not_checked' : button.width >= contract.minimumTarget && button.height >= contract.minimumTarget ? 'pass' : 'fail',
      { width: button.width, height: button.height, minimum: contract.minimumTarget }, 'Use the canonical minimum target in both dimensions.', button.selector);
    const hasOutline = Number.isFinite(button.outlineWidth) && button.outlineWidth > 0 && ['solid', 'double', 'dashed', 'dotted'].includes(button.outlineStyle);
    let focusStatus = button.focused !== true ? 'not_checked' : hasOutline && button.focusVisible === true ? 'pass' : 'fail';
    if (!hasOutline && button.boxShadow && button.boxShadow !== 'none') focusStatus = 'unsupported';
    if (button.occlusionRisk || button.outlineStyle === 'auto') focusStatus = 'unsupported';
    add('focus', 'STYLE-A11Y-001', focusStatus,
      { keyboardFocused: button.focused, focusVisible: button.focusVisible, outlineWidth: button.outlineWidth, outlineStyle: button.outlineStyle },
      'Expose an unclipped visible keyboard focus treatment; non-outline treatments need separate review.', button.selector);
    const foreground = rgb(button.outlineColor); const background = rgb(button.adjacentColor);
    const ratio = foreground && background ? (Math.max(luminance(foreground), luminance(background)) + 0.05) / (Math.min(luminance(foreground), luminance(background)) + 0.05) : null;
    const supported = ratio !== null && button.backgroundImage === 'none' && !button.occlusionRisk;
    add('focus-contrast', 'STYLE-A11Y-010', focusStatus === 'not_checked' ? 'not_checked' : !supported || !hasOutline || focusStatus === 'unsupported' ? 'unsupported' : ratio >= contract.minimumFocusContrast ? 'pass' : 'fail',
      { ratio, minimum: contract.minimumFocusContrast, foreground: button.outlineColor, background: button.adjacentColor },
      'Use a focus ring with adequate contrast against this rendered adjacent surface.', button.selector);
  }
  if (!(observed.buttons?.length)) add('target', 'STYLE-A11Y-009', 'not_checked', null, 'Configure at least one visible button target.', 'buttons');
  const dialog = observed.dialog;
  if (!dialog?.found || !dialog.visible) {
    for (const [check, rule] of [['name', '011'], ['initial-focus', '012'], ['containment', '012'], ['escape', '013'], ['return-focus', '012']])
      add(check, `STYLE-A11Y-${rule}`, 'not_checked', null, 'Open the configured dialog and collect this observation.');
  } else {
    add('name', 'STYLE-A11Y-011', boolean(dialog.namedByVisibleTitle === undefined || dialog.roleNameMatched === undefined ? undefined : dialog.namedByVisibleTitle && dialog.roleNameMatched),
      dialog.name, 'Reference the visible dialog title through aria-labelledby.');
    add('initial-focus', 'STYLE-A11Y-012', boolean(dialog.initialFocusInside), dialog.initialFocusInside, 'Move focus inside the dialog when opening.');
    const steps = [...(dialog.forward ?? []), ...(dialog.backward ?? [])];
    const complete = Number.isInteger(dialog.focusableCount) && dialog.focusableCount > 0 &&
      dialog.forward?.length >= dialog.focusableCount + 1 && dialog.backward?.length >= dialog.focusableCount + 1;
    add('containment', 'STYLE-A11Y-012', steps.includes(false) ? 'fail' : complete && steps.every(x => x === true) ? 'pass' : 'not_checked',
      { forward: dialog.forward, backward: dialog.backward, focusableCount: dialog.focusableCount }, 'Keep keyboard focus inside the open dialog in both directions.');
    const escape = typeof dialog.escapeClosed !== 'boolean' ? 'not_checked' : dialog.escapeAllowed === true ? boolean(dialog.escapeClosed) :
      dialog.escapeAllowed === false ? boolean(!dialog.escapeClosed && typeof dialog.exceptionReason === 'string' && dialog.exceptionReason.trim().length > 0) : 'not_checked';
    add('escape', 'STYLE-A11Y-013', escape, { allowed: dialog.escapeAllowed, closed: dialog.escapeClosed, exception: dialog.exceptionReason }, 'Honor Escape dismissal or document an explicit non-dismissible exception.');
    add('return-focus', 'STYLE-A11Y-012', boolean(dialog.returnFocus), dialog.returnFocus, 'Return focus to the trigger when closing.');
  }
  const status = checks.some(x => x.status === 'fail') ? 'fail' : checks.every(x => x.status === 'pass') ? 'pass' : 'not_checked';
  return { schemaVersion: 1, status, specSha256: contract.specSha256, specHashScope: contract.specHashScope,
    artifactSha256: identity.artifactSha256 ?? null, checks, limitations: ['Configured light-DOM targets and declared interaction path only.', 'Focus contrast supports opaque RGB outlines on flat opaque surfaces; clipping and overlays need review.', 'Not a complete accessibility audit or proof of arbitrary generated UI.'] };
}

/** Trusted local report -> bounded repair input. Hashes must come from current source, not a model. */
export function createRepairPacket({ report, expectedSpecSha256, expectedArtifactSha256, targetPaths }) {
  if (!/^[a-f0-9]{64}$/.test(expectedArtifactSha256) || !/^[a-f0-9]{64}$/.test(expectedSpecSha256) ||
      report.artifactSha256 !== expectedArtifactSha256 || report.specSha256 !== expectedSpecSha256) throw new Error('Stale or unbound browser evidence');
  const findings = report.checks.flatMap((check, index) => {
    if (check.status === 'pass') return [];
    const path = targetPaths[check.target];
    if (typeof path !== 'string' || !path || path.includes('..') || path.includes(':') || path.startsWith('/')) throw new Error('Missing or unsafe target source mapping');
    return [{ ruleId: check.ruleId, path, target: check.target, check: check.check,
      evidenceKind: check.status === 'fail' ? 'observed' : 'unverified', status: check.status,
      evidenceRef: `checks[${index}]`, observed: check.observed, proposedCorrection: check.fix }];
  });
  return { schemaVersion: 1, artifactSha256: expectedArtifactSha256, specSha256: expectedSpecSha256,
    findings, instruction: 'Repair only mapped findings. Recheck after any mutation; this packet authorizes no publication.',
    limitations: report.limitations };
}
