/** Presentation derived from evidence, never a new compliance verdict. Shared with Studio. */
export function describeTarget(check){return check.selector&&check.selector!==check.target?`${check.selector} (label ${check.target})`:check.target;}
export function summarizeCoverage(report) {
  const checks=report.checks??[];
  const counts=Object.fromEntries(['pass','fail','not_checked','unsupported'].map(status=>[status,checks.filter(check=>check.status===status).length]));
  const evaluated=counts.pass+counts.fail;
  const targets=[...new Set(checks.map(describeTarget))];
  const widths=[...new Set(checks.map(check=>check.viewport?.width).filter(width=>Number.isFinite(width)&&width>0))].sort((a,b)=>a-b);
  const journeyWidth=report.runningApp?.journeyViewport??report.browserScope?.journeyViewport;
  const incomplete=checks.filter(check=>!['pass','fail'].includes(check.status)).map(check=>({target:describeTarget(check),check:check.check,status:check.status,viewport:check.viewport?.width,
    reason:check.limitation??check.fix??'No reason recorded; inspect the raw evidence.',next:check.fix??'Review manually and recheck with supported inputs.'}));
  return {counts,total:checks.length,evaluated,targets,widths,incomplete,
    headline:checks.length?`${evaluated} of ${checks.length} recorded checks evaluated`:'No check evidence recorded',
    breakdown:`${counts.pass} passed · ${counts.fail} failed · ${counts.not_checked} not checked · ${counts.unsupported} unsupported`,
    scope:[`Recorded targets: ${targets.join(', ')||'none'}`,`Journey viewport: ${Number.isFinite(journeyWidth)&&journeyWidth>0?journeyWidth+'px':'not recorded'}`,
      `Measurement viewports: ${widths.length?widths.map(width=>width+'px').join(', '):'not recorded'}`,
      'Counts describe recorded checks, not the fraction of your application covered. Other routes, targets, viewport sizes and unexercised interaction states remain untested.',
    ],limitations:report.limitations??[]};
}
