import {createHash} from 'node:crypto';
import {compareReports} from './html-report.mjs';

// Requirements belong in scope; measurements and verdicts do not.
const canonical=value=>JSON.stringify(normalize(value));
function normalize(value) {
  if(Array.isArray(value))return value.map(normalize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalize(value[key])]));
  return value;
}
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const key=check=>canonical([check.ruleId,check.check,check.target,check.viewport?.width??null]);
const ordered=report=>[...report.checks].sort((a,b)=>key(a).localeCompare(key(b)));
function requirement(check) {
  if(Object.hasOwn(check,'expected'))return check.expected;
  // v0.9 journey reports bind their fixed behavior to rule IDs; numeric
  // requirements and Escape exceptions were recorded alongside measurements.
  const rules={target:'009',focus:'001','focus-contrast':'010',name:'011','initial-focus':'012',
    containment:'012',escape:'013','return-focus':'012',label:'003','error-association':'006','close-path':'012'};
  const products={disabled:'PROJECT-DISABLED-001',loading:'PROJECT-LOADING-001',overflow:'PROJECT-LAYOUT-001'};
  if(check.ruleId!==`STYLE-A11Y-${rules[check.check]}`&&check.ruleId!==products[check.check])return null;
  if(['target','focus-contrast'].includes(check.check))return Number.isFinite(check.observed?.minimum)?
    {minimum:check.observed.minimum}:null;
  if(check.check==='escape')return typeof check.observed?.allowed==='boolean'?
    {allowed:check.observed.allowed,exception:check.observed.exception??null}:null;
  if(check.check==='overflow')return Number.isFinite(check.observed?.viewportWidth)?
    {viewportWidth:check.observed.viewportWidth}:null;
  return {configuredJourneyRequirement:check.check};
}
const scope=report=>canonical({
  specHashScope:report.specHashScope??null,browserScope:report.browserScope??null,
  runningApp:report.runningApp?{integration:report.runningApp.integration,viewports:report.runningApp.viewports,journeyViewport:report.runningApp.journeyViewport}:null,
  checks:ordered(report).map(check=>({key:key(check),selector:check.selector??null,viewport:check.viewport??null,expected:requirement(check)}))
});
const outcomes=report=>canonical(ordered(report).map(check=>[key(check),check.status]));
const incomplete=report=>report.checks.some(check=>!['pass','fail'].includes(check.status));
const binding=report=>({artifactSha256:report.artifactSha256,specSha256:report.specSha256,
  projectConfigurationSha256:report.projectConfigurationSha256,reportSha256:digest(report)});
const reference=check=>({ruleId:check.ruleId,check:check.check,target:check.target,viewport:check.viewport??null,status:check.status});

export function compareCandidates(baseline,candidateA,candidateB) {
  const reports=[baseline,candidateA,candidateB].map(value=>value?.report??value);
  const result={schemaVersion:1,historyOnly:true,preference:null,compatible:false,candidates:[],exitCode:2,
    limitation:'Recorded observations only. No source freshness, causal benefit, authenticity, repair permission, consensus or release approval is established.'};
  try {
    for(const report of reports) {
      if(!compareReports(report,report).compatible||report.checks.some(check=>
        !check.ruleId||!check.check||!check.target||requirement(check)==null||
        (['pass','fail'].includes(check.status)&&check.observed==null)))throw new Error('Missing or invalid report bindings, requirements, observations or check identities.');
    }
    result.bindings=Object.fromEntries(reports.map((report,i)=>[['baseline','A','B'][i],binding(report)]));
    const base=reports[0],prior=new Map(base.checks.map(check=>[key(check),check]));
    for(const [i,report] of reports.slice(1).entries()) {
      if(!compareReports(report,base).compatible||scope(report)!==scope(base))throw new Error('Rules, configuration, expected requirements or rendered coverage differ.');
      result.candidates.push({candidate:['A','B'][i],
        resolved:report.checks.filter(check=>check.status==='pass'&&prior.get(key(check)).status==='fail').map(reference),
        regressed:report.checks.filter(check=>check.status!=='pass'&&prior.get(key(check)).status==='pass').map(reference),
        remaining:report.checks.filter(check=>check.status==='fail').map(reference),
        incomplete:report.checks.filter(check=>!['pass','fail'].includes(check.status)).map(reference)});
    }
    result.compatible=true;
    for(let i=0;i<reports.length;i++)for(let j=i+1;j<reports.length;j++) {
      if(reports[i].artifactSha256===reports[j].artifactSha256&&outcomes(reports[i])!==outcomes(reports[j]))
        throw new Error('Identical recorded source has conflicting outcomes. Recheck the environment before selecting a candidate.');
    }
    if(reports.some(incomplete))throw new Error('Incomplete evidence prevents preference. Unsupported and unverified checks remain unresolved.');
    const qualified=result.candidates.filter(candidate=>!candidate.remaining.length&&!candidate.regressed.length&&candidate.resolved.length);
    result.preference=qualified.length===1?qualified[0].candidate:null;
    result.reason=result.preference?`Recorded checks favor candidate ${result.preference}: it resolves baseline failures with no recorded regression.`:
      qualified.length>1?'No preference: both candidates satisfy the recorded checks.':'No preference: neither candidate is a complete improvement over the baseline.';
    result.exitCode=0;
  } catch(error) {
    result.reason=error instanceof TypeError?'Malformed report evidence.':error.message;
  }
  return result;
}
