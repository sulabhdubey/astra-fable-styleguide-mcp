import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,realpath} from 'node:fs/promises';
import {dirname,relative,resolve,isAbsolute} from 'node:path';
import {compareReports} from './html-report.mjs';
import {loadProject,snapshotProject} from './project-workflow.mjs';
import {loadRunningProject} from './running-app.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity=c=>JSON.stringify([c.ruleId,c.check,c.target,c.viewport?.width??null]);
const md=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\`*_{}[\]()#+.!|@]/g,c=>`&#${c.charCodeAt(0)};`).replace(/[\r\n]+/g,' ');
const textInput=path=>/\.(?:css|html|js|cjs|mjs|jsx|ts|tsx|json|txt)$/i.test(path);

export function createGitEvidence(git,result) {
  if(!git||!['commit','tree'].every(k=>/^[a-f0-9]{40}$/.test(git[k]))||typeof git.projectPath!=='string'||git.projectPath.startsWith('/')||git.projectPath.includes('..'))throw new Error('Invalid Git evidence binding');
  const self=compareReports(result?.report??result,result);
  if(!self.compatible)throw new Error('Invalid or incomplete report binding');
  const payload={schemaVersion:1,kind:'stylecon-git-evidence',git,result};
  return {...payload,evidenceSha256:digest(payload)};
}
function verify(value) {
  if(!value||typeof value!=='object')throw new Error('Missing evidence');
  const {evidenceSha256,...payload}=value;
  if(digest(payload)!==evidenceSha256)throw new Error('Evidence integrity mismatch');
  const rebuilt=createGitEvidence(value.git,value.result);
  if(rebuilt.evidenceSha256!==evidenceSha256)throw new Error('Invalid evidence structure');
  return value.result.report??value.result;
}

/** A local receipt is integrity-bound evidence, not a signature or a trusted attestation. */
export function compareGitEvidence(base,head) {
  const current=verify(head);
  const binding={baseCommit:base?.git?.commit??null,headCommit:head.git.commit,constitutionSha256:current.specSha256};
  if(!base)return {...binding,compatible:false,reason:'Baseline unavailable; no clean comparison can be claimed.',exitCode:2};
  const previous=verify(base),comparison=compareReports(current,previous);
  if(!comparison.compatible||base.git.projectPath!==head.git.projectPath)return {...binding,compatible:false,reason:comparison.reason??'Project identities differ.',exitCode:2};
  const old=new Map(previous.checks.map(c=>[identity(c),c]));
  const newViolations=current.checks.filter(c=>c.status==='fail'&&old.get(identity(c)).status!=='fail');
  const resolved=current.checks.filter(c=>c.status==='pass'&&old.get(identity(c)).status==='fail');
  const existingViolations=current.checks.filter(c=>c.status==='fail'&&old.get(identity(c)).status==='fail');
  const incomplete=current.checks.filter(c=>['unsupported','not_checked'].includes(c.status));
  return {...binding,compatible:true,newViolations,resolved,existingViolations,incomplete,
    exitCode:incomplete.length?2:newViolations.length||existingViolations.length?1:0};
}
export function renderPrSummary(comparison) {
  const heading=`## Style Constitution\n\nBase: ${md(comparison.baseCommit??'unavailable')}\n\nHead: ${md(comparison.headCommit)}\n\nConstitution: ${md(comparison.constitutionSha256)}\n\n`;
  if(!comparison.compatible)return heading+`**Comparison unavailable.** ${md(comparison.reason)}\n\nExit status: 2 (incomplete).\n`;
  const groups=[['New violations',comparison.newViolations],['Resolved',comparison.resolved],['Existing violations',comparison.existingViolations],['Incomplete / unsupported',comparison.incomplete]];
  const detail=value=>md(JSON.stringify(value??'not recorded').slice(0,1000));
  return heading+groups.map(([name,checks])=>`### ${name}: ${checks.length}\n\n`+(checks.length?checks.map(c=>`- **${md(c.ruleId)}** · ${md(c.target)} · ${md(c.check)}: ${md(c.status)}. ${md(c.fix)}\n  - Observed: ${detail(c.observed)}\n  - Expected: ${detail(c.expected)}`).join('\n'):'None recorded.')+'\n').join('\n')+`\nExit status: ${comparison.exitCode}. Findings apply to configured checks only. Receipts are not signed attestations.\n`;
}

export async function captureGitEvidence(configPath,check) {
  const config=await realpath(configPath),configuration=JSON.parse(await readFile(config,'utf8'));
  const running=configuration.schemaVersion===2;
  const project=running?await loadRunningProject(config):await loadProject(config);
  const git=(...args)=>execFileSync('git',['-C',project.root,...args],{encoding:'utf8',maxBuffer:8_000_000}).trimEnd();
  const root=await realpath(git('rev-parse','--show-toplevel'));
  const projectPath=relative(root,config).replaceAll('\\','/');
  if(isAbsolute(projectPath)||projectPath.startsWith('../'))throw new Error('Project must be inside its Git repository');
  const commit=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
  const snapshot=running?project.identity.before:await snapshotProject(project);
  const paths=running?[config,...Object.keys(snapshot.files).map(key=>{
    const source=`source/${project.config.sourceDirectory}/`,build=`build/${project.config.buildDirectory}/`;
    if(key.startsWith(source))return resolve(project.root,project.config.sourceDirectory,key.slice(source.length));
    if(key.startsWith(build))return resolve(project.root,project.config.buildDirectory,key.slice(build.length));
    if(key.startsWith('identity/'))return resolve(project.root,key.slice('identity/'.length));
    throw new Error('Invalid running project identity path');
  }),...(project.config.constitution?[resolve(project.root,project.config.constitution.path)]:[])]:[config,...project.config.files.map(file=>resolve(project.root,file)),...(project.config.constitution?[resolve(project.root,project.config.constitution.path)]:[])];
  const assertTracked=async()=>{
    try { git('diff','--quiet','--'); git('diff','--cached','--quiet','--'); }
    catch { throw new Error('Check requires clean, committed project inputs'); }
    for(const path of paths) {
      const rel=relative(root,path).replaceAll('\\','/');
      let committed;try {committed=execFileSync('git',['-C',root,'show',`${commit}:${rel}`],{maxBuffer:8_000_000});}catch {throw new Error('Check requires clean, committed project inputs');}
      const current=await readFile(path);
      // Git may normalize CRLF in known text inputs. Binary build assets must match byte-for-byte.
      const normalized=bytes=>bytes.toString('utf8').replaceAll('\r\n','\n');
      if(textInput(path)?normalized(committed)!==normalized(current):!committed.equals(current))throw new Error('Check requires clean, committed project inputs');
    }
  };
  await assertTracked();
  const checked=await check(config);
  await assertTracked();
  const after=running?(await loadRunningProject(config)).identity.before:await snapshotProject(project);
  const report=checked.result.report??checked.result;
  const snapshotHash=running?snapshot.sha256:snapshot.artifactSha256;
  if(git('rev-parse','HEAD')!==commit||(running?after.sha256:after.artifactSha256)!==snapshotHash||report.artifactSha256!==snapshotHash||(running&&report.runningApp?.identity?.sha256!==snapshotHash))throw new Error('Git/project changed during capture');
  return createGitEvidence({commit,tree,projectPath},checked.result);
}
