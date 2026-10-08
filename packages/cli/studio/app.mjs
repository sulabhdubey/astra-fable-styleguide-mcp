/* global document, location, history, navigator, Blob, URL, setTimeout */
import {summarizeCoverage,describeTarget} from './coverage.mjs';
const $=id=>document.getElementById(id);
const token=location.hash.slice(1);history.replaceState(null,'','/');
let project='',previewHash='',candidateHash='',catalog=[],changes=[],busy=false,runningCandidates=[];
let setupHash='',adoptionHash='',briefHash='',reviewHash='';
let selectedFindings=new Set();
const message=(text,error=false)=>{$('message').textContent=text;$('message').dataset.error=String(error);};
async function api(action,fields={}){const response=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-stylecon-session':token},body:JSON.stringify({action,...fields})});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;}
async function perform(work){
  if(busy)return;
  const initiatingControl=document.activeElement;
  busy=true;$('workspace-controls').disabled=true;
  document.body.setAttribute('aria-busy','true');message('Working locally…');
  try{await work();}
  catch(error){message(error.message,true);}
  finally{
    busy=false;$('workspace-controls').disabled=false;document.body.removeAttribute('aria-busy');
    const target=initiatingControl?.isConnected&&!initiatingControl.disabled&&initiatingControl.offsetParent!==null&&initiatingControl!==document.body?initiatingControl:$('message');
    target.focus({preventScroll:true});
  }
}
function option(value,label){const node=document.createElement('option');node.value=value;node.textContent=label;return node;}
function findingFacts(check,source){$('finding-facts').replaceChildren();for(const [label,value]of [['Element',check.selector??check.target],['Target label',check.target],['Source label',source??'Unmapped'],['Viewport',check.viewport?.width?`${check.viewport.width}px`:'Journey'],['Observed',check.observed],['Expected',check.expected??check.fix],['Guidance',check.fix],['Limitation',check.limitation??'See coverage summary']]){const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=typeof value==='object'?Object.entries(value??{}).map(([key,item])=>`${key}: ${typeof item==='object'?JSON.stringify(item):item}`).join(' · '):String(value??'Not recorded');$('finding-facts').append(term,detail);}}
function filterChecks(){for(const row of $('findings').children)row.hidden=row.dataset.status==='pass'&&!$('show-passed').checked;}
$('show-passed').onchange=filterChecks;
function invalidate(){previewHash='';$('preview').hidden=true;candidateHash='';$('candidate').hidden=true;}
async function projects(){const result=await api('projects');$('project').replaceChildren(option('','Select a project'),...result.projects.map(p=>option(p.path,`${p.path} · ${p.configured?'configured':'choose targets'}`)));await selectProject();message(`${result.projects.length} local projects found.`);}
function clearSetupReview(){setupHash='';$('setup-review').hidden=true;}
function setupKind(){clearSetupReview();const vite=$('setup-kind').value==='vite';$('setup').hidden=vite;$('vite-setup').hidden=!vite;}
$('setup-kind').onchange=setupKind;
$('vite-setup').oninput=clearSetupReview;
$('vite-setup').onsubmit=event=>{event.preventDefault();perform(async()=>{
  clearSetupReview();const options=Object.fromEntries([...$('vite-setup').querySelectorAll('input')].map(input=>[input.name,input.value]));
  const preview=await api('setup-preview',{project,options});setupHash=preview.previewSha256;
  $('setup-scope').textContent=preview.scope;$('setup-rules').replaceChildren();
  for(const measurement of preview.measurements)for(const group of ['typography','spacing'])for(const [property,value]of Object.entries(measurement.expected[group])){
    const item=document.createElement('li');item.textContent=`${measurement.selector} · ${group}.${property} → ${value}`;$('setup-rules').append(item);
  }
  $('setup-json').textContent=JSON.stringify(preview.config,null,2);$('setup-hash').textContent=setupHash;$('setup-review').hidden=false;message('Review the resolved rules and configuration, then save. Browser targets are not yet verified.');
});};
$('save-setup').onclick=()=>perform(async()=>{await api('setup-save',{project,previewSha256:setupHash});await selectProject();});
function showCoverage(report){
  const coverage=summarizeCoverage(report);$('coverage-title').textContent=coverage.headline;$('coverage-counts').textContent=coverage.breakdown;
  $('coverage-scope').replaceChildren();for(const text of coverage.scope){const item=document.createElement('li');item.textContent=text;$('coverage-scope').append(item);}
  $('coverage-limits').replaceChildren();for(const text of coverage.limitations){const item=document.createElement('li');item.textContent=text;$('coverage-limits').append(item);}$('coverage-incomplete').hidden=!coverage.incomplete.length;$('coverage-reasons').replaceChildren();
  for(const reason of coverage.incomplete){const item=document.createElement('li');item.textContent=`${reason.target} · ${reason.check}${reason.viewport?' · '+reason.viewport+'px':''}: ${reason.reason} Next: ${reason.next}`;$('coverage-reasons').append(item);}
}
function clearBrief(){briefHash='';$('brief-review').hidden=true;$('brief-text').value='';}
function clearReview(){reviewHash='';$('review-preview').hidden=true;$('review-findings').replaceChildren();$('review-data').textContent='';$('review-ack').checked=false;$('download-review').disabled=$('download-review-json').disabled=true;}
function clearAdoption(){adoptionHash='';$('adoption-review').hidden=true;}
async function refreshHistory(){
  const history=await api('history',{project});
  const options=()=>history.entries.map(entry=>option(entry.id,`${entry.createdAt} · ${entry.available?entry.status:'unavailable'}`));
  $('history-base').replaceChildren(...options());$('history-head').replaceChildren(...options());
  if(history.entries.length>1)$('history-base').selectedIndex=1;
  $('open-history').disabled=!history.entries.length;$('compare-history').disabled=history.entries.length<2;
  $('history-note').textContent=`${history.entries.length} saved runs · ${history.unavailableCount} unavailable. Up to ${history.limit} runs per project. Evidence stays private.`;
  $('run-history').hidden=false;
}
async function selectProject(){
  clearSetupReview();clearCheckEvidence();clearAdoption();
  for(const id of ['setup-choice','vite-setup','undo','targets','setup','project-rules','run-history','history-comparison'])$(id).hidden=true;
  project=$('project').value;invalidate();$('run').disabled=!project;$('adoption-recovery').hidden=true;if(!project)return;
  const adoption=await api('adoption-status',{project});
  if(adoption.pending){$('adoption-recovery').hidden=false;$('adoption-recovery').open=true;$('run').disabled=true;await refreshHistory();message('Pending rule adoption requires recovery before continuing.',true);return;}
  const list=await api('projects');const selected=list.projects.find(p=>p.path===project);
  if(!selected?.configured){$('setup-choice').hidden=false;setupKind();$('run').disabled=true;message('Choose IDs for a static page, or select React / Vite to configure a production preview.');return;}
  $('project').selectedOptions[0].textContent=`${project} · configured`;
  await refreshHistory();
  const config=await api('config',{project});
  $('target-content').textContent=JSON.stringify({integration:config.integration??'static HTML',journey:config.journey,targetPaths:config.targetPaths,measurements:config.measurements,constitution:config.constitution??'Bundled rules'},null,2);
  $('targets').hidden=false;$('project-rules').hidden=false;
  message(config.schemaVersion===2?'Running application selected. Start its trusted Vite production preview before checking. Verified stylesheet corrections require a rebuild.':'Project ready. Its configured dialog and controls will be exercised.');
}
function showResult(data,{historical=false}={}){
  clearBrief();clearReview();$('review-handoff').hidden=historical;selectedFindings=new Set();$('results').hidden=false;
  $('result-status').textContent=data.summary.status;$('result-status').dataset.status=data.summary.status;
  const report=data.result.report;showCoverage(report);$('finding-detail').hidden=true;
  $('result-title').textContent=`${historical?'Historical observation · ':''}${report.checks.length} configured checks`;
  $('binding').textContent=`Source ${report.artifactSha256}\nConstitution ${report.specSha256}`;
  $('report-file').textContent=historical?'Stored observation only. Run checks to obtain current evidence.':`Private evidence saved: ${data.reportFile}`;
  $('findings').replaceChildren();
  for(const [index,check]of report.checks.entries()){
    const row=document.createElement('tr');row.dataset.status=check.status;
    for(const text of [check.status,describeTarget(check),check.ruleId+(check.viewport?.width?` · ${check.viewport.width}px`:'')]){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}
    const cell=document.createElement('td'),button=document.createElement('button');button.textContent='Inspect';
    button.addEventListener('click',()=>{$('finding-detail').hidden=false;findingFacts(check,data.targetPaths[check.target]);$('finding-json').textContent=JSON.stringify({...check,source:data.targetPaths[check.target]??'unmapped'},null,2);$('finding-detail').scrollIntoView({block:'nearest'});});cell.append(button);
    if(!historical&&check.status!=='pass'){
      const label=document.createElement('label'),input=document.createElement('input');label.className='filter';input.type='checkbox';input.value=data.findingIds[index];
      input.setAttribute('aria-label',`Include ${check.ruleId} ${describeTarget(check)} ${check.viewport?.width??'journey'} in brief`);
      input.onchange=()=>{clearBrief();if(input.checked)selectedFindings.add(input.value);else selectedFindings.delete(input.value);};
      label.append(input,document.createTextNode('Include in brief'));cell.append(label);
    }
    row.append(cell);$('findings').append(row);
  }
  $('show-passed').checked=report.status==='pass';filterChecks();
  $('agent-handoff').hidden=historical||report.checks.every(check=>check.status==='pass');
  runningCandidates=historical?[]:data.result.repair?.candidates??[];
  const paths=historical?[]:[...new Set((data.result.repair?.findings??[]).filter(f=>f.status==='fail').map(f=>f.path))];
  $('repair-path').replaceChildren(...(runningCandidates.length?runningCandidates.map(c=>option(c.id,`${c.selector} · ${c.property}: ${c.before} → ${c.after}`)):paths.map(p=>option(p,p))));
  $('before').disabled=$('after').disabled=runningCandidates.length>0;$('before').required=$('after').required=!runningCandidates.length;
  $('before').value=runningCandidates[0]?.before??'';$('after').value=runningCandidates[0]?.after??'';
  $('correction').hidden=!paths.length&&!runningCandidates.length;previewHash='';$('preview').hidden=true;
  message(historical?'Historical evidence opened. Run checks before preparing a brief or correction.':data.summary.status==='pass'?'Configured checks passed. Evidence is scoped to these targets.':'Review highlighted findings and any incomplete checks.');
}
$('refresh').onclick=()=>perform(projects);$('project').onchange=()=>perform(selectProject);
function clearCheckEvidence(){previewHash='';clearBrief();clearReview();selectedFindings=new Set();for(const id of ['results','finding-detail','correction','preview','agent-handoff','review-handoff'])$(id).hidden=true;}
async function checkProject(){clearCheckEvidence();clearAdoption();$('history-comparison').hidden=true;const result=await api('check',{project});await refreshHistory();showResult(result);}
$('run').onclick=()=>perform(checkProject);
$('setup').onsubmit=event=>{event.preventDefault();perform(async()=>{const options={};for(const input of $('setup').querySelectorAll('input'))options[input.name]=input.value;await api('init',{project,options});await selectProject();});};
$('correction').onsubmit=event=>{event.preventDefault();perform(async()=>{const preview=await api('preview',{project,change:runningCandidates.length?{candidateId:$('repair-path').value}:{path:$('repair-path').value,before:$('before').value,after:$('after').value}});previewHash=preview.previewSha256;$('diff').textContent=typeof preview.diff==='string'?preview.diff:JSON.stringify(preview.diff,null,2);$('preview-hash').textContent=previewHash;$('preview').hidden=false;message('Review the exact change. Apply only if this is the correction you intend.');});};
for(const id of ['before','after','repair-path'])$(id).oninput=()=>{previewHash='';$('preview').hidden=true;if(runningCandidates.length){const selected=runningCandidates.find(c=>c.id===$('repair-path').value);$('before').value=selected?.before??'';$('after').value=selected?.after??'';}};
$('apply').onclick=()=>perform(async()=>{const applied=await api('apply',{project,previewSha256:previewHash});clearCheckEvidence();$('undo').hidden=false;if(applied.requiresRebuild){message('Source corrected. Rebuild your trusted Vite project, then Run checks. Undo is available.');return;}await checkProject();message('Correction applied and rechecked. Inspect the new result; undo is available.');});
$('undo').onclick=()=>perform(async()=>{const undone=await api('undo',{project});clearCheckEvidence();$('undo').hidden=true;if(undone.requiresRebuild){message('Original source restored. Rebuild your trusted Vite project, then Run checks.');return;}await checkProject();message('Original source restored and rechecked.');});
for(const name of ['checks','constitution'])$(name+'-nav').onclick=()=>{for(const id of ['checks','constitution']){$(id).hidden=id!==name;$(id+'-nav').classList.toggle('active',id===name);}};
function tokenValue(){const item=catalog.find(c=>c.path===$('token-path').value);$('token-value').value=item?.value??'';$('token-current').textContent=`Current value: ${item?.value??''}`;}
function renderChanges(){candidateHash='';$('candidate').hidden=true;$('changes').replaceChildren();for(const change of changes){const li=document.createElement('li');li.textContent=`${change.path} → ${change.value}`;$('changes').append(li);}if(!changes.length){const li=document.createElement('li');li.textContent='No changes selected.';$('changes').append(li);}}
$('load-catalog').onsubmit=event=>{event.preventDefault();perform(async()=>{catalog=(await api('catalog',{source:$('source').value})).items;$('token-path').replaceChildren(...catalog.map(item=>option(item.path,item.path.replace('tokens.','').replace('.$value',''))));$('token-editor').hidden=false;changes=[];renderChanges();tokenValue();message('Canonical rules loaded. Select changes for review.');});};
$('source').oninput=()=>{catalog=[];changes=[];renderChanges();$('token-editor').hidden=true;};$('token-path').onchange=tokenValue;
$('token-editor').onsubmit=event=>{event.preventDefault();const item=catalog.find(c=>c.path===$('token-path').value);const value=typeof item.value==='number'?Number($('token-value').value):$('token-value').value;changes=changes.filter(c=>c.path!==item.path);changes.push({path:item.path,value});renderChanges();message('Change added for validation and review.');};
$('clear-changes').onclick=()=>{changes=[];renderChanges();};
$('import-css').onclick=()=>perform(async()=>{const result=await api('import',{css:$('css').value});$('suggestions').replaceChildren();for(const suggestion of result.suggestions){const row=document.createElement('div');row.textContent=`${suggestion.provenance.variable}: ${suggestion.value} → ${suggestion.path} `;const button=document.createElement('button');button.className='quiet';button.textContent='Add to review';button.disabled=!catalog.some(item=>item.path===suggestion.path);button.onclick=()=>{changes=changes.filter(c=>c.path!==suggestion.path);changes.push({path:suggestion.path,value:suggestion.value});renderChanges();button.disabled=true;};row.append(button);$('suggestions').append(row);}const note=document.createElement('p');note.textContent=`${result.unmapped.length} variables have no supported mapping. Suggestions are not approved rules.`;$('suggestions').append(note);message('Review each imported suggestion before adding it.');});
$('review-rules').onclick=()=>perform(async()=>{const rule=$('exception-rule').value,target=$('exception-target').value,reason=$('exception-reason').value;const data=await api('candidate',{source:$('source').value,changes,exceptions:rule||target||reason?[{rule,target,reason}]:[]});candidateHash=data.candidateSha256;$('candidate-diff').textContent=JSON.stringify({changes:data.beforeAfterDiff,exceptions:data.exceptions},null,2);$('candidate-hash').textContent=candidateHash;$('candidate').hidden=false;message('Candidate validated. Review changes and approve this exact hash to export.');});
for(const id of ['exception-rule','exception-target','exception-reason'])$(id).oninput=()=>{candidateHash='';$('candidate').hidden=true;};
$('export-rules').onclick=()=>perform(async()=>{await api('export',{candidateSha256:candidateHash,destination:$('destination').value});$('candidate').hidden=true;$('snapshot-source').value=$('destination').value;message('Approved constitution exported. In Check & correct, open Use your team’s rules to create a snapshot and review adoption.');});
$('prepare-review').onclick=()=>perform(async()=>{
  clearReview();const {packet}=await api('review-preview',{project});reviewHash=packet.packetSha256;
  $('review-summary').textContent=`${packet.scope.total} recorded checks · ${packet.counts.pass} passed · ${packet.counts.fail} need attention · ${packet.counts.not_checked} not checked · ${packet.counts.unsupported} unsupported. ${packet.disclosure.omittedFields} check fields omitted.`;
  for(const check of packet.checks){const card=document.createElement('details'),heading=document.createElement('summary'),facts=document.createElement('pre');heading.textContent=`${check.target} · ${check.check} · ${check.status}${check.viewport?' · '+check.viewport.width+'px':''}`;facts.textContent=JSON.stringify({rule:check.rule,observed:check.observed,expected:check.expected,omitted:check.omitted},null,2);card.open=check.status!=='pass';card.append(heading,facts);$('review-findings').append(card);}
  $('review-data').textContent=JSON.stringify(packet,null,2);$('review-hash').textContent=reviewHash;$('review-preview').hidden=false;
  message('Review packet prepared. Inspect the contents and omissions before downloading.');
});
$('review-ack').onchange=()=>{$('download-review').disabled=$('download-review-json').disabled=!$('review-ack').checked||!reviewHash;};
async function downloadReview(format){
  if(!reviewHash||!$('review-ack').checked)throw new Error('Review this packet before downloading');
  let result;try{result=await api('review-download',{project,packetSha256:reviewHash,format});}catch(error){clearReview();throw error;}
  const url=URL.createObjectURL(new Blob([result.text],{type:result.type})),link=document.createElement('a');link.href=url;link.download=result.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  message('Reviewed packet downloaded locally. Open it to inspect before sharing; it is historical evidence only.');
}
$('download-review').onclick=()=>perform(()=>downloadReview('html'));
$('download-review-json').onclick=()=>perform(()=>downloadReview('json'));
$('prepare-brief').onclick=()=>perform(async()=>{
  clearBrief();const result=await api('brief',{project,selectedIds:[...selectedFindings]});briefHash=result.brief.briefSha256;
  $('brief-text').value=result.text;$('brief-binding').textContent=`Brief ${briefHash}`;$('brief-review').hidden=false;
  message('Brief prepared. Review the selected facts and private text before copying.');
});
$('copy-brief').onclick=()=>perform(async()=>{
  if(!briefHash)throw new Error('Prepare and review the brief first');
  // Recheck file identity at the point of copying; never silently copy a changed packet.
  let result;try{result=await api('brief',{project,selectedIds:[...selectedFindings]});}catch(error){clearBrief();throw error;}
  if(result.brief.briefSha256!==briefHash){clearBrief();throw new Error('Brief changed. Prepare and review it again.');}
  try{await navigator.clipboard.writeText(result.text);message('Reviewed brief copied. Recheck the project after any changes.');}
  catch{$('brief-text').focus();$('brief-text').select();message('Clipboard unavailable. Copy the selected reviewed text manually.');}
});
$('open-history').onclick=()=>perform(async()=>{
  clearCheckEvidence();clearAdoption();$('undo').hidden=true;
  const result=await api('history-read',{project,id:$('history-head').value});showResult(result.checked,{historical:true});
});
$('compare-history').onclick=()=>perform(async()=>{
  $('history-comparison').hidden=true;
  const result=await api('history-compare',{project,baseId:$('history-base').value,headId:$('history-head').value});
  $('comparison-summary').textContent=result.compatible?'Same recorded rules, configuration and coverage. Inspect new, outstanding, resolved and incomplete findings below.':`Comparison unavailable: ${result.reason}`;
  $('comparison-details').textContent=JSON.stringify(result,null,2);$('history-comparison').hidden=false;
  message(result.compatible?'Historical comparison ready. This is not a new check of current source.':'These runs cannot establish resolution. Review their different scope or rules.');
});
$('adopt-path').oninput=clearAdoption;
$('create-snapshot').onclick=()=>perform(async()=>{
  clearAdoption();await api('snapshot',{project,source:$('snapshot-source').value,snapshotPath:$('adopt-path').value});
  message('New snapshot created. Review rule adoption before changing this project.');
});
$('adopt-preview').onclick=()=>perform(async()=>{
  clearAdoption();const preview=await api('adopt-preview',{project,snapshotPath:$('adopt-path').value});adoptionHash=preview.previewSha256;
  $('adoption-diff').textContent=JSON.stringify({before:preview.before,after:preview.after,checkedRuleDiff:preview.checkedRuleDiff,configuration:preview.configDiff},null,2);
  $('adoption-hash').textContent=adoptionHash;$('adoption-review').hidden=false;message('Review the rule changes and exact configuration pin before adoption.');
});
$('adopt-rules').onclick=()=>perform(async()=>{
  const approved=adoptionHash;clearCheckEvidence();clearAdoption();$('undo').hidden=true;
  await api('adopt',{project,previewSha256:approved});await selectProject();message('Reviewed rules adopted. Run checks again; previous evidence uses its original rules.');
});
$('recover-adoption').onclick=()=>perform(async()=>{
  clearCheckEvidence();clearAdoption();const result=await api('adopt-recover',{project});await selectProject();message(`Rule-adoption recovery: ${result.outcome}. Run checks before using this project's evidence.`);
});
if(token)perform(projects);else message('Open the complete local Studio link printed by the CLI, including its session fragment.',true);
