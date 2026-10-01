import {createHash} from 'node:crypto';
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {loadRunningProject,runRunningCheck} from './running-app.mjs';
import {withRepairLock,receiptRoot,commitRepair} from './project-workflow.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const sourceIdentity=(project,files)=>hash(JSON.stringify({configHash:project.configHash,files,specSha256:project.contract.specSha256}));
async function sourceSnapshot(project) {
  const current=await loadRunningProject(project.configPath);
  if(current.configHash!==project.configHash)throw new Error('Configuration changed; reload project');
  const files=Object.fromEntries(Object.entries(current.identity.before.files).filter(([key])=>!key.startsWith('build/')));
  return {files,artifactSha256:sourceIdentity(current,files),contract:current.contract};
}

export async function previewRunningRepair(configPath,packet,change) {
  if(packet?.schemaVersion!==2||packet.integration!=='vite-preview'||!change||Object.keys(change).some(key=>key!=='candidateId')||typeof change.candidateId!=='string')throw new Error('Select one verified running repair candidate');
  // Re-observe instead of trusting an editable report file as write authority.
  const checked=await runRunningCheck(configPath),fresh=checked.result.repair;
  if(!fresh||fresh.artifactSha256!==packet.artifactSha256||fresh.specSha256!==packet.specSha256||fresh.configHash!==packet.configHash)throw new Error('Stale running repair evidence');
  const candidate=fresh.candidates.find(item=>item.id===change.candidateId);
  if(!candidate||!packet.candidates?.some(item=>item.id===candidate.id))throw new Error('Repair candidate is not supported by current browser evidence');
  const project=await loadRunningProject(configPath);
  if(project.identity.before.sha256!==fresh.artifactSha256)throw new Error('Stale running repair evidence');
  const sheet=project.repairStylesheets.find(item=>item.source===candidate.path);
  if(!sheet||hash(sheet.text)!==candidate.sourceSha256||sheet.text.slice(candidate.start,candidate.end)!==candidate.before)throw new Error('Stale mapped source declaration');
  const before=await sourceSnapshot(project),original=sheet.text,replacement=original.slice(0,candidate.start)+candidate.after+original.slice(candidate.end);
  const afterFiles={...before.files,[`source/${candidate.path}`]:hash(replacement)};
  return {schemaVersion:1,integration:'vite-preview',configHash:project.configHash,path:candidate.path,specSha256:fresh.specSha256,
    previousArtifactSha256:before.artifactSha256,artifactSha256:sourceIdentity(project,afterFiles),
    verifiedBuildArtifactSha256:fresh.artifactSha256,candidateId:candidate.id,original,replacement,originalSha256:hash(original),replacementSha256:hash(replacement),
    diff:{path:candidate.path,selector:candidate.selector,property:candidate.property,before:candidate.before,after:candidate.after},requiresRebuild:true,requiresBrowserRecheck:true};
}
export async function applyRunningRepair(configPath,packet,change,{receiptDirectory}={}) {
  const project=await loadRunningProject(configPath);
  return withRepairLock(project,async()=>{
    const preview=await previewRunningRepair(configPath,packet,change);
    const result=await commitRepair(project,preview,receiptDirectory,sourceSnapshot,async()=>{
      const current=await loadRunningProject(configPath);
      if(current.identity.before.sha256!==preview.verifiedBuildArtifactSha256||current.configHash!==preview.configHash||current.contract.specSha256!==preview.specSha256)throw new Error('Stale running build evidence');
    });
    return {...result,requiresRebuild:true};
  });
}
export async function undoRunningRepair(configPath,receiptPath,{receiptDirectory}={}) {
  const project=await loadRunningProject(configPath);
  return withRepairLock(project,async()=>{
    const directory=await receiptRoot(project,receiptDirectory),receipt=await realpath(receiptPath),rel=relative(directory,receipt);
    if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw new Error('Receipt is outside the private receipt directory');
    const info=await stat(receipt);if(!info.isFile()||info.size>1_000_000)throw new Error('Invalid running repair receipt');
    const record=JSON.parse(await readFile(receipt,'utf8'));
    if(record.schemaVersion!==1||record.integration!=='vite-preview'||record.phase!=='prepared'||record.configHash!==project.configHash||!project.repairStylesheets.some(sheet=>sheet.source===record.path)||typeof record.original!=='string'||typeof record.replacement!=='string'||hash(record.original)!==record.originalSha256||hash(record.replacement)!==record.replacementSha256)throw new Error('Invalid running repair receipt');
    const current=await sourceSnapshot(project);
    if(current.artifactSha256!==record.artifactSha256||current.contract.specSha256!==record.specSha256||current.files[`source/${record.path}`]!==record.replacementSha256)throw new Error('Stale undo evidence');
    const restored={...current.files,[`source/${record.path}`]:record.originalSha256};
    if(sourceIdentity(project,restored)!==record.previousArtifactSha256)throw new Error('Invalid original source snapshot');
    const result=await commitRepair(project,{...record,previousArtifactSha256:record.artifactSha256,artifactSha256:record.previousArtifactSha256,original:record.replacement,replacement:record.original,originalSha256:record.replacementSha256,replacementSha256:record.originalSha256,diff:{...record.diff,before:record.diff.after,after:record.diff.before}},receiptDirectory,sourceSnapshot);
    return {...result,requiresRebuild:true};
  });
}
