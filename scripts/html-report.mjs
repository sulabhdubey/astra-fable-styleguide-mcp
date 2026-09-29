const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const statuses=['pass','fail','unsupported','not_checked'];
const key=check=>JSON.stringify([check.ruleId,check.check,check.target]);
function validReport(report) {
  return report&&/^[a-f0-9]{64}$/.test(report.artifactSha256)&&/^[a-f0-9]{64}$/.test(report.specSha256)&&
    Array.isArray(report.checks)&&report.checks.length>0&&new Set(report.checks.map(key)).size===report.checks.length&&
    report.checks.every(check=>statuses.includes(check.status)&&['ruleId','check','target'].every(field=>typeof check[field]==='string'))&&
    report.status===(report.checks.some(c=>c.status==='fail')?'fail':report.checks.every(c=>c.status==='pass')?'pass':'not_checked');
}

function observation(value,pixels=false) {
  if(value===null||value===undefined)return 'Not observed';
  if(typeof value==='boolean')return value?'Yes':'No';
  if(Array.isArray(value))return value.length?`<ul>${value.map(item=>`<li>${observation(item,pixels)}</li>`).join('')}</ul>`:'None recorded';
  if(typeof value==='object')return `<dl>${Object.entries(value).map(([key,item])=>`<dt>${escape(key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase()))}</dt><dd>${typeof item==='number'?escape(Number(item.toFixed(2)))+(pixels&&['width','height','minimum'].includes(key)?' px':''):observation(item)}</dd>`).join('')}</dl>`;
  return escape(value);
}

export function compareReports(current,previous) {
  const before=previous?.report??previous;
  if(!validReport(current)||!validReport(before)||current.specSha256!==before.specSha256||
      !/^[a-f0-9]{64}$/.test(current.projectConfigurationSha256)||current.projectConfigurationSha256!==before.projectConfigurationSha256) {
    return {compatible:false,reason:'Rules, project configuration, or evidence bindings differ or are missing. Run both checks with the same pinned setup.'};
  }
  const checks=new Map(before.checks.map(check=>[key(check),check]));
  if(checks.size!==current.checks.length||current.checks.some(check=>!checks.has(key(check))))return {compatible:false,reason:'The recorded check coverage differs.'};
  return {compatible:true,sourceChanged:current.artifactSha256!==before.artifactSha256,
    resolved:current.checks.filter(check=>check.status==='pass'&&checks.get(key(check)).status==='fail').length,
    regressed:current.checks.filter(check=>check.status!=='pass'&&checks.get(key(check)).status==='pass').length,
    priorArtifactSha256:before.artifactSha256};
}

export function renderHtmlReport(result,targetPaths,{previous}={}) {
  const report=result.report??result;if(!validReport(report))throw new Error('Cannot render an empty or unbound verification report');
  const counts=Object.fromEntries(statuses.map(status=>[status,report.checks.filter(check=>check.status===status).length]));
  const overall=counts.fail?'fail':counts.pass===report.checks.length?'pass':'not_checked';
  if(overall!==report.status)throw new Error('Report status disagrees with checks');
  const label=status=>({pass:'Passed',fail:'Needs attention',unsupported:'Unsupported',not_checked:'Not checked'}[status]);
  const comparison=previous?compareReports(report,previous):null;
  const comparisonHtml=!comparison?'':comparison.compatible?`<section aria-labelledby="recheck"><h2 id="recheck">Recheck comparison</h2><p><strong>${comparison.resolved} finding${comparison.resolved===1?'':'s'} resolved</strong> · ${comparison.regressed} checks regressed.</p><p>${comparison.sourceChanged?'The source snapshot changed.':'The source snapshot is unchanged; this is a repeated observation.'} These are observed results, not proof that a particular edit caused the change.</p><p class="hash">Previous artifact: ${escape(comparison.priorArtifactSha256)}</p></section>`:`<section><h2>Comparison unavailable</h2><p>${escape(comparison.reason)}</p></section>`;
  const cards=report.checks.map(check=>`<details class="check ${check.status}"${check.status==='pass'?'':' open'}><summary><span class="badge ${check.status}">${label(check.status)}</span><strong>${escape(check.target)}</strong><span>${escape(check.check)}</span></summary><div class="detail"><p class="eyebrow">${escape(check.ruleId)} · ${escape(targetPaths[check.target]??'Source mapping unavailable')}</p><h3>Observation</h3><div class="observed">${observation(check.observed,check.check==='target')}</div><h3>${check.status==='fail'?'Correction to review':'Rule guidance'}</h3><p>${escape(check.fix)}</p></div></details>`).join('\n');
  const constitution=report.constitution;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Style Constitution — verification report</title>
<style>
:root{font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#17243b;background:#eef1f6;color-scheme:light}*{box-sizing:border-box}body{margin:0}a{color:#244da5}a:focus-visible,summary:focus-visible{outline:3px solid #244da5;outline-offset:5px}.skip{position:absolute;left:-9999px}.skip:focus{left:1rem;top:1rem;background:white;padding:1rem;z-index:1}header{background:#12243d;color:#f3f6ff;padding:3.5rem max(1.25rem,calc((100% - 1040px)/2)) 3rem;border-bottom:5px solid #8ed8ce}.eyebrow{font-size:.76rem;letter-spacing:.12em;text-transform:uppercase;font-weight:700}header .eyebrow{color:#a6e3db}h1{font-size:clamp(2rem,5vw,3.5rem);line-height:1.1;letter-spacing:-.04em;max-width:18ch;margin:.7rem 0 1.2rem}header p{max-width:66ch}main{max-width:1080px;margin:auto;padding:1.6rem 1.25rem 4rem}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:.8rem;margin-bottom:1.6rem}.metric,section{background:white;border:1px solid #ced6e2;border-radius:12px}.metric{padding:1rem}.metric strong{display:block;font-size:2rem;line-height:1.2}.metric span{font-size:.85rem}section{padding:1.5rem;margin:1.2rem 0}h2{font-size:1.25rem;letter-spacing:-.02em;margin:0 0 1rem}h3{font-size:.9rem;margin:1.2rem 0 .4rem}.scope{border-left:4px solid #4262a3}.badge{font-size:.72rem;font-weight:750;border-radius:999px;padding:.18rem .65rem;white-space:nowrap;display:inline-block}.badge.pass{color:#175a3e;background:#e1f2e8}.badge.fail{color:#8e2f1f;background:#ffe7dd}.badge.unsupported,.badge.not_checked{color:#714409;background:#fff0ce}.check{border-top:1px solid #dbe1e9}.check:first-of-type{border-top:0}summary{cursor:pointer;display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;padding:1.05rem 0}summary:after{content:'+';margin-left:auto;font-size:1.25rem}details[open]>summary:after{content:'−'}summary strong,summary span{overflow-wrap:anywhere}.detail{padding:0 0 1.2rem 1rem;border-left:3px solid #dbe1e9;margin-bottom:1rem}pre{background:#f2f5f9;padding:1rem;border-radius:8px;font-size:.83rem;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}.hash{font: .77rem/1.65 ui-monospace,Consolas,monospace;overflow-wrap:anywhere}footer{font-size:.83rem;color:#485870}ul{padding-left:1.2rem}li{margin:.5rem 0}.identity{overflow-wrap:anywhere}@media(max-width:600px){.metrics{grid-template-columns:repeat(2,1fr)}header{padding:2.5rem 1.25rem 2rem}section{padding:1rem}summary{gap:.5rem}.detail{padding-left:.7rem}}@media print{body{background:white}header{color:#17243b;background:white;padding:1rem}main{max-width:none}details{break-inside:avoid}.metrics{grid-template-columns:repeat(4,1fr)}}
dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:.4rem 1rem;margin:0}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}.observed{background:#f2f5f9;padding:1rem;border-radius:8px}.identity summary{padding:.25rem 0}
</style></head><body><a class="skip" href="#results">Skip to findings</a>
<header><p class="eyebrow">Astra + Fable / Style Constitution</p><h1>Your interface, checked against its rules.</h1><p><span class="badge ${overall}">${label(overall)}</span></p><p>This report records a configured browser journey. A pass applies to the checks listed here; incomplete and unsupported evidence stays visible.</p></header>
<main><div class="metrics" aria-label="Check counts">${statuses.map(status=>`<div class="metric"><strong>${counts[status]}</strong><span>${label(status)}</span></div>`).join('')}</div>
<section class="identity"><h2>Constitution</h2><p>${escape(constitution?`${constitution.name} · ${constitution.version}`:'Version not recorded by this report')}</p><details><summary>Evidence identifiers</summary><p class="hash">Specification: ${escape(report.specSha256)}<br>Artifact: ${escape(report.artifactSha256)}</p><p>${report.specHashScope?.includes('JSON.stringify')?'Bound to the bundled button, dialog and accessibility rules.':escape(report.specHashScope??'Specification hash scope not recorded')}</p></details></section>
${comparisonHtml}<section id="results"><h2>Findings and observations</h2><p>Expand a check to inspect its observation and correction guidance. Applying a correction requires review, followed by a new browser check.</p>${cards}</section>
<section class="scope"><h2>Coverage and limitations</h2><ul>${(report.limitations??[]).map(item=>`<li>${escape(item)}</li>`).join('')}</ul><p>No release approval or complete accessibility certification is conferred by this report.</p></section>
<footer>Generated locally. No remote assets or telemetry. Reports can contain project details; keep them private.</footer></main></body></html>`;
}
