import {createHash} from 'node:crypto';
import {compareReports} from './html-report.mjs';
import {findingId} from './agent-brief.mjs';

const statuses=['pass','fail','not_checked','unsupported'];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const exact=(value,keys)=>object(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const dimension=value=>Number.isFinite(value)&&value>0&&value<=100_000;
const labels={target:'Target size',focus:'Visible keyboard focus','focus-contrast':'Focus contrast',name:'Dialog accessible name',
  'initial-focus':'Initial dialog focus',containment:'Dialog focus containment',escape:'Escape dismissal','return-focus':'Return focus',
  label:'Input label','error-association':'Input error association',disabled:'Disabled state',loading:'Loading state',overflow:'Horizontal overflow',
  'close-path':'Configured close action','typography.fontSize':'Font size','typography.fontFamily':'Font family','typography.fontWeight':'Font weight',
  'typography.lineHeight':'Line height','spacing.paddingTop':'Top padding',contrast:'Text contrast'};
const knownLabels=new Set([...Object.values(labels),'Other configured check']);
const knownRules=new Set([...Array.from({length:13},(_,i)=>`STYLE-A11Y-${String(i+1).padStart(3,'0')}`),
  'PROJECT-DISABLED-001','PROJECT-LOADING-001','PROJECT-LAYOUT-001','STYLE-MEASURE-TYPOGRAPHY','STYLE-MEASURE-SPACING','STYLE-MEASURE-OVERFLOW','Other recorded rule']);
// A positive field inventory: arbitrary labels, diagnostics, selectors and nested
// project objects never enter a shareable packet. Unknown fields are counted.
const measurementKeys=new Set(('width height minimum maximum ratio foreground background color backgroundColor composited outlineWidth outlineOffset outlineStyle outlineColor '
  +'viewportWidth contentWidth scrollWidth maximumScrollWidth allowed closed returnFocus initialFocusInside complete expectedSteps steps forward backward '
  +'found nativeDisabled busy statusVisible invalid focused errorAssociated errorVisible labelled namedByVisibleTitle roleNameMatched visible supported').split(' '));
const scalar=value=>value===null||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value))||
  (typeof value==='string'&&value.length<=80&&(/^-?\d+(?:\.\d+)?(?:px|rem|em|%)?$/.test(value)||/^#[a-f\d]{3,8}$/i.test(value)||/^rgba?\([\d.,% /]+\)$/.test(value)||['none','solid','dashed','dotted','double'].includes(value)));
const safeMeasurement=value=>scalar(value)||(Array.isArray(value)&&value.length<=64&&value.every(scalar))||
  (object(value)&&Object.keys(value).length<=40&&Object.entries(value).every(([key,item])=>measurementKeys.has(key)&&scalar(item)));
const outcome=counts=>counts.not_checked+counts.unsupported?'incomplete':counts.fail?'attention':'pass';
const countsFor=checks=>Object.fromEntries(statuses.map(status=>[status,checks.filter(check=>check.status===status).length]));

/** Minimal-disclosure observation, not a trust assertion, signature or repair packet. */
export function createReviewPacket(report) {
  if(!object(report)||(report.schemaVersion!==undefined&&report.schemaVersion!==1)||!Array.isArray(report.checks)||report.checks.length>1000||!compareReports(report,report).compatible)throw new Error('Invalid review report binding, status or coverage');
  const ids=report.checks.map(findingId);if(new Set(ids).size!==ids.length)throw new Error('Duplicate review check');
  const aliases=new Map();let omittedFields=0;
  const checks=report.checks.map((check,index)=>{
    let omitted=0;
    function measurement(value) {
      if(scalar(value))return value;
      if(Array.isArray(value)&&value.length<=64&&value.every(scalar))return [...value];
      if(object(value)&&Object.keys(value).length<=40) {
        return Object.fromEntries(Object.entries(value).flatMap(([key,item])=>{
          if(measurementKeys.has(key)&&scalar(item))return [[key,item]];
          omitted++;return [];
        }));
      }
      omitted++;return null;
    }
    const identity=JSON.stringify([check.target,check.selector??null]);
    if(!aliases.has(identity))aliases.set(identity,`Element ${aliases.size+1}`);
    const result={id:`check-${index+1}`,target:aliases.get(identity),check:Object.hasOwn(labels,check.check)?labels[check.check]:'Other configured check',
      rule:knownRules.has(check.ruleId)?check.ruleId:'Other recorded rule',status:check.status,
      viewport:check.viewport?{width:check.viewport.width,...(check.viewport.height===undefined?{}:{height:check.viewport.height})}:null,
      observed:measurement(check.observed),expected:measurement(check.expected),omitted:0};
    // Identity and free-form text are deliberately excluded even when apparently harmless.
    omitted+=Object.keys(check).filter(key=>!['check','ruleId','status','observed','expected','viewport'].includes(key)).length;
    if(result.check==='Other configured check')omitted++;
    if(result.rule==='Other recorded rule')omitted++;
    result.omitted=omitted;omittedFields+=omitted;return result;
  });
  const counts=countsFor(checks);
  const journeyViewport=report.runningApp?.journeyViewport??report.browserScope?.journeyViewport??null;
  if(journeyViewport!==null&&!dimension(journeyViewport))throw new Error('Invalid journey viewport');
  const payload={schemaVersion:1,kind:'stylecon-review-packet',authority:'observation-only',
    bindings:Object.fromEntries(['artifactSha256','specSha256','projectConfigurationSha256'].map(key=>[key,report[key]])),
    sourceReportSha256:hash(report),status:outcome(counts),counts,scope:{total:checks.length,targets:aliases.size,journeyViewport},checks,
    disclosure:{policy:'minimal-v1',omittedFields,omittedReportFields:Object.keys(report).filter(key=>!['schemaVersion','status','artifactSha256','specSha256','projectConfigurationSha256','checks'].includes(key)).length}};
  const packet={...payload,packetSha256:hash(payload)};verifyReviewPacket(packet);return packet;
}

/** Verifies format and internal checksum only. A sender can rewrite and rehash. */
export function verifyReviewPacket(packet) {
  const fail=()=>{throw new Error('Invalid or changed review packet. Verify format and checksum; this is not author authentication.');};
  if(!exact(packet,['schemaVersion','kind','authority','bindings','sourceReportSha256','status','counts','scope','checks','disclosure','packetSha256'])||packet.schemaVersion!==1||packet.kind!=='stylecon-review-packet'||packet.authority!=='observation-only')fail();
  if(!exact(packet.bindings,['artifactSha256','specSha256','projectConfigurationSha256'])||!Object.values(packet.bindings).every(sha)||!sha(packet.sourceReportSha256)||!sha(packet.packetSha256))fail();
  if(!Array.isArray(packet.checks)||!packet.checks.length||packet.checks.length>1000||!exact(packet.counts,statuses)||!Object.values(packet.counts).every(integer))fail();
  if(!exact(packet.scope,['total','targets','journeyViewport'])||packet.scope.total!==packet.checks.length||!integer(packet.scope.targets)||(packet.scope.journeyViewport!==null&&!dimension(packet.scope.journeyViewport)))fail();
  if(!exact(packet.disclosure,['policy','omittedFields','omittedReportFields'])||packet.disclosure.policy!=='minimal-v1'||!integer(packet.disclosure.omittedFields)||!integer(packet.disclosure.omittedReportFields))fail();
  const targets=new Set();let omitted=0;
  for(const [index,c]of packet.checks.entries()){
    if(!exact(c,['id','target','check','rule','status','viewport','observed','expected','omitted'])||c.id!==`check-${index+1}`||!knownLabels.has(c.check)||!knownRules.has(c.rule)||!statuses.includes(c.status)||!integer(c.omitted)||!safeMeasurement(c.observed)||!safeMeasurement(c.expected))fail();
    if(typeof c.target!=='string'||!/^Element [1-9]\d{0,3}$/.test(c.target))fail();
    if(!targets.has(c.target)&&c.target!==`Element ${targets.size+1}`)fail();targets.add(c.target);omitted+=c.omitted;
    if(c.viewport!==null&&(!(exact(c.viewport,['width'])||exact(c.viewport,['width','height']))||!dimension(c.viewport.width)||(c.viewport.height!==undefined&&!dimension(c.viewport.height))))fail();
  }
  if(packet.scope.targets!==targets.size||omitted!==packet.disclosure.omittedFields||statuses.some(status=>packet.counts[status]!==countsFor(packet.checks)[status])||packet.status!==outcome(packet.counts))fail();
  const {packetSha256,...payload}=packet;if(hash(payload)!==packetSha256)fail();return packet;
}

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function display(value,pixels=false,key='') {
  if(value===null)return 'Not included';
  if(typeof value==='boolean')return value?'Yes':'No';
  if(typeof value==='number')return escape(Number(value.toFixed(2)))+(pixels&&['width','height','minimum','maximum','viewportWidth','contentWidth','scrollWidth','maximumScrollWidth'].includes(key)?' px':'');
  if(Array.isArray(value))return value.length?value.map(item=>display(item,pixels)).join(', '):'No values recorded';
  if(object(value))return Object.keys(value).length?`<dl>${Object.entries(value).map(([name,item])=>`<dt>${escape(name.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase()))}</dt><dd>${display(item,pixels,name)}</dd>`).join('')}</dl>`:'Not included';
  return escape(value);
}
const statusLabel={pass:'Passed',fail:'Needs attention',not_checked:'Not checked',unsupported:'Unsupported'};
const checkCard=c=>`<article class="check"><h3>${escape(c.target)} · ${escape(c.check)}${c.viewport?' · '+c.viewport.width+'px':''}</h3><p class="badge ${c.status}">${statusLabel[c.status]}</p><p>${escape(c.rule)} · ${c.id}</p><dl><dt>Observed</dt><dd>${display(c.observed,['Target size','Horizontal overflow'].includes(c.check))}</dd><dt>Expected</dt><dd>${display(c.expected,['Target size','Horizontal overflow'].includes(c.check))}</dd></dl><p>${c.omitted} fields omitted. ${['not_checked','unsupported'].includes(c.status)?'Evidence gap: request manual review or a supported recheck.':c.status==='fail'?'Request a correction and a fresh check using the same rules and scope.':'Pass applies only to this recorded check.'}</p></article>`;
export function renderReviewPacket(value) {
  const p=verifyReviewPacket(value);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Style Constitution — review packet</title><style>
*{box-sizing:border-box}body{margin:0;background:#eef1f6;color:#17243b;font:16px/1.6 system-ui,sans-serif}header{background:#12243d;color:#fff;border-bottom:5px solid #8ed8ce;padding:2.5rem max(1.25rem,calc((100% - 980px)/2))}h1{font-size:clamp(2rem,5vw,3rem);line-height:1.15}main{max-width:1020px;margin:auto;padding:1.25rem}section{background:white;border:1px solid #ced6e2;border-radius:12px;padding:1.25rem;margin-bottom:1rem}h2{font-size:1.35rem}h3{font-size:1.05rem}strong,pre,dd,p{overflow-wrap:anywhere}pre{white-space:pre-wrap;font-size:.8rem;background:#f2f5f9;padding:.8rem}.counts{display:grid;grid-template-columns:repeat(4,1fr);gap:.75rem}.counts div{padding:.7rem;background:#f2f5f9}.counts strong{display:block;font-size:1.8rem}.check{border-top:1px solid #ced6e2;padding:1rem 0}.badge{font-weight:700}.fail{color:#8e2f1f}.not_checked,.unsupported{color:#714409}.pass{color:#175a3e}dl{display:grid;grid-template-columns:6rem minmax(0,1fr);gap:.3rem 1rem}dd{margin:0}summary{cursor:pointer}summary:focus-visible{outline:3px solid #244da5;outline-offset:4px}.note{border-left:4px solid #4262a3}footer{font-size:.85rem}@media(max-width:600px){.counts{grid-template-columns:repeat(2,1fr)}dl{grid-template-columns:1fr}dd{margin-bottom:.7rem}}@media print{body{background:white}header{background:white;color:#17243b;padding:1rem}.check{break-inside:avoid}}
</style></head><body><header><p>STYLE CONSTITUTION / REVIEW</p><h1>A clear view of the recorded checks.</h1><p>${p.status==='incomplete'?'Evidence is incomplete. Review the gaps below.':p.status==='attention'?'Some checks need attention.':'All recorded checks passed.'}</p><p>Historical observation only. This file does not check the current application.</p></header><main>
<section><h2>Every recorded check</h2><div class="counts">${statuses.map(s=>`<div><strong>${p.counts[s]}</strong>${statusLabel[s]}</div>`).join('')}</div><p>${p.scope.total} checks across ${p.scope.targets} aliased targets. Journey viewport: ${p.scope.journeyViewport===null?'not recorded':p.scope.journeyViewport+'px'}.</p><p>Counts are not the fraction of the application covered. Other routes, elements, viewport sizes and interaction states remain untested.</p></section>
<section class="note"><h2>Before making a decision</h2><p>Ask the sender which page and elements this packet describes. Target names and selectors are aliased to reduce disclosure. Compare the evidence identifiers with the developer's current check before accepting a correction.</p><p>Omitted: ${p.disclosure.omittedFields} check fields and ${p.disclosure.omittedReportFields} report fields. Source paths, free-form diagnostics, rule names, exception text and other project details are not included. Measurements use a limited field inventory; omissions are not successful checks. Ask the developer for a private explanation of missing values, limitations and exceptions.</p><p>A passing recorded result is not release approval or complete accessibility certification. Manual review is still required.</p></section>
<section><h2>Findings and measurements</h2>${p.checks.filter(c=>c.status!=='pass').map(checkCard).join('')||'<p>No failed or incomplete checks were recorded.</p>'}${p.counts.pass?`<details><summary>${p.counts.pass} passed checks — expand measurements</summary>${p.checks.filter(c=>c.status==='pass').map(checkCard).join('')}</details>`:''}</section>
<section><h2>Evidence identifiers</h2><p>This checksum is not a signature. It does not establish the sender's identity, truth of observations, or current source freshness. No repair or publishing authority is granted.</p><pre>Packet: ${p.packetSha256}\nSource: ${p.bindings.artifactSha256}\nRules: ${p.bindings.specSha256}\nConfiguration: ${p.bindings.projectConfigurationSha256}\nOriginal report: ${p.sourceReportSha256}</pre><details><summary>Exact packet data</summary><pre>${escape(JSON.stringify(p,null,2))}</pre></details></section>
<footer>Displayed numbers are rounded to two decimals; packet data retains exact values. Generated locally. No scripts, external assets, network calls or telemetry. Review the complete document before sharing; typed measurements and fingerprints may still be sensitive.</footer></main></body></html>`;
}
