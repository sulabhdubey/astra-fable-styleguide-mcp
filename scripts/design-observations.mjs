function rgb(value) {
  const match = /^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*(1(?:\.0+)?))?\)$/.exec(value ?? '');
  return match ? match.slice(1, 4).map(Number) : null;
}
function luminance(channels) {
  return channels.map(channel => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}
function sameFont(left, right) { return String(left).replace(/["']/g, '').replace(/\s+/g, '') === String(right).replace(/["']/g, '').replace(/\s+/g, ''); }
function pixels(value) { const match = /^(\d+(?:\.\d+)?)px$/.exec(value ?? ''); return match ? Number(match[1]) : null; }
function dimension(value, base) {
  const match = /^(\d+(?:\.\d+)?)(px|rem|em)$/.exec(value ?? '');
  if (!match) return null;
  const amount = Number(match[1]); return match[2] === 'px' ? amount : Number.isFinite(base) ? amount * base : null;
}
function expectedDimension(property, expected, observed) {
  const unit = /(?:px|rem|em)$/.test(expected ?? '');
  if (!unit) return { supported: false, pixels: null };
  const base = expected.endsWith('rem') ? pixels(observed.rootFontSize) : expected.endsWith('em') ? property === 'fontSize' ? pixels(observed.parentFontSize) : pixels(observed.fontSize) : null;
  const value = dimension(expected, base);
  return { supported: value !== null, pixels: value };
}
function lineHeight(value, fontSize) {
  if (typeof value === 'number') return value;
  const pixels = /^(\d+(?:\.\d+)?)px$/.exec(value ?? ''); const size = /^(\d+(?:\.\d+)?)px$/.exec(fontSize ?? '');
  return pixels && size && Number(size[1]) > 0 ? Number(pixels[1]) / Number(size[1]) : null;
}

/** Evaluate configured rendered values. All expected values are resolved canonical values. */
export function evaluateDesignObservations(measurements) {
  const checks = [];
  const add = (measurement, check, ruleId, status, observed, expected, limitation) => checks.push({
    check, ruleId, target: measurement.target, status, observed, expected, viewport: measurement.viewport, limitation,
    fix:status==='unsupported'||status==='not_checked'?`Review manually: ${limitation}`:check==='overflow'?'Remove page overflow at the recorded viewport width.':check==='contrast'?'Meet the declared text contrast minimum on the measured surface.':`Match ${check} to the recorded canonical expected value.`
  });
  for (const measurement of measurements) {
    const { expected, observed } = measurement;
    const available = measurement.found === true;
    for (const [property, expectedValue] of Object.entries(expected.typography ?? {})) {
      const actual = property === 'lineHeight' ? lineHeight(observed.lineHeight, observed.fontSize) : observed[property];
      const expectedPixels = property === 'fontSize' ? expectedDimension(property, expectedValue, observed) : null;
      const matched = property === 'fontFamily' ? sameFont(actual, expectedValue) : property === 'lineHeight' ? Number.isFinite(actual) && Math.abs(actual - expectedValue) < 0.01 : property === 'fontSize' ? Number.isFinite(pixels(actual)) && expectedPixels.supported && Math.abs(pixels(actual) - expectedPixels.pixels) < 0.01 : actual === expectedValue;
      const status = !available || actual === undefined || actual === null ? 'not_checked' : property === 'fontSize' && !expectedPixels.supported ? 'unsupported' : matched ? 'pass' : 'fail';
      add(measurement, `typography.${property}`, 'STYLE-MEASURE-TYPOGRAPHY', status, actual, expectedValue, property === 'fontSize' && !expectedPixels.supported ? 'Only px, rem and em expected font sizes can be compared with computed pixels.' : 'Computed style compared to the configured canonical token value.');
    }
    for (const [property, expectedValue] of Object.entries(expected.spacing ?? {})) {
      const actual = observed[property];
      const expectedPixels = property === 'paddingTop' ? expectedDimension(property, expectedValue, observed) : null;
      const matched = Number.isFinite(pixels(actual)) && expectedPixels.supported && Math.abs(pixels(actual) - expectedPixels.pixels) < 0.01;
      const status = !available || actual === undefined || actual === null ? 'not_checked' : !expectedPixels.supported ? 'unsupported' : matched ? 'pass' : 'fail';
      add(measurement, `spacing.${property}`, 'STYLE-MEASURE-SPACING', status, actual, expectedValue, !expectedPixels.supported ? 'Only px, rem and em expected padding can be compared with computed pixels.' : 'Computed style compared to the configured canonical token value.');
    }
    if (expected.contrast) {
      const foreground = rgb(observed.color); const background = rgb(observed.backgroundColor);
      const opaque = foreground && background && observed.backgroundImage === 'none' && observed.composited !== true;
      const ratio = opaque ? (Math.max(luminance(foreground), luminance(background)) + 0.05) / (Math.min(luminance(foreground), luminance(background)) + 0.05) : null;
      add(measurement, 'contrast', expected.contrast.ruleId, !measurement.found ? 'not_checked' : !opaque ? 'unsupported' : ratio >= expected.contrast.minimum ? 'pass' : 'fail',
        { ratio, foreground: observed.color, background: observed.backgroundColor, composited: observed.composited === true }, expected.contrast, 'Only opaque flat-surface text can be measured; transparency, image backgrounds and compositing need review.');
    }
    const overflow = measurement.viewport?.scrollWidth > measurement.viewport?.width;
    add(measurement, 'overflow', 'STYLE-MEASURE-OVERFLOW', !available || !measurement.viewport ? 'not_checked' : overflow ? 'fail' : 'pass', measurement.viewport, { maximumScrollWidth: measurement.viewport.width }, 'Configured viewport only; nested scrolling regions require a dedicated target.');
  }
  return checks;
}
