import fs from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {basename, dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TextDecoder} from 'node:util';
import {loadPinnedConstitution} from './constitution.mjs';
import {loadProject, snapshotProject} from './project-workflow.mjs';
import {loadRunningProject,cssTokens,expectedMeasurement} from './running-app.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const repository=fileURLToPath(new URL('../',import.meta.url));
const snapshotName=/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.json$/;
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const inside=(root,path)=>{const rel=relative(root,path);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);};
const decode=bytes=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
async function exists(path){try{await fs.lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}

async function location(configPath,{evidenceDirectory,missing=false,allowHardlinks=false,requireSameFilesystem=true}={}) {
  const requested=resolve(configPath);
  if(basename(requested)!=='project.json')throw new Error('Constitution adoption requires project.json');
  const root=await fs.realpath(dirname(requested));
  if(!samePath(root,dirname(requested)))throw new Error('Project directory aliases are unsupported');
  if(inside(resolve(repository,'spec'),requested))throw new Error('Canonical /spec cannot be changed by adoption');
  if(!missing||await exists(requested)) {
    const info=await fs.lstat(requested);
    if(!info.isFile()||info.isSymbolicLink()||(!allowHardlinks&&info.nlink!==1)||info.size>32_000)throw new Error('Unsupported project configuration file or link');
  }
  if(typeof evidenceDirectory!=='string'||!isAbsolute(evidenceDirectory))throw new Error('An absolute private evidence directory is required for adoption');
  const evidence=await fs.realpath(evidenceDirectory);
  if(!samePath(evidence,resolve(evidenceDirectory))||inside(root,evidence))throw new Error('Adoption evidence must be outside the project without directory aliases');
  if(inside(resolve(repository,'spec'),evidence))throw new Error('Canonical /spec cannot contain adoption journals');
  const [projectInfo,evidenceInfo]=await Promise.all([fs.stat(root),fs.stat(evidence)]);
  if(!evidenceInfo.isDirectory())throw new Error('Adoption evidence directory must already exist');
  if(requireSameFilesystem&&projectInfo.dev!==evidenceInfo.dev)throw new Error('Cross-filesystem constitution adoption is unsupported; choose evidence on the project filesystem');
  const identity=process.platform==='win32'?requested.toLowerCase():requested;
  const directory=resolve(evidence,`constitution-adoption-${hash(identity)}`);
  if(await exists(directory)) {
    const info=await fs.lstat(directory);
    if(!info.isDirectory()||info.isSymbolicLink()||!samePath(await fs.realpath(directory),directory))throw new Error('Unsafe adoption journal directory');
    if(requireSameFilesystem&&info.dev!==projectInfo.dev)throw new Error('Cross-filesystem adoption journal is unsupported');
  }
  return {root,configPath:requested,evidence,directory,pending:resolve(directory,'pending')};
}

// Replace only the top-level pin value, retaining every other config byte.
function pinConfig(text,pin) {
  function end(start) {
    if(text[start]==='"'){let i=start+1;for(;i<text.length;i++){if(text[i]==='\\')i++;else if(text[i]==='"')return i+1;}throw new Error('Invalid configuration string');}
    if(text[start]==='{'||text[start]==='['){const close=text[start]==='{'?'}':']';let i=start+1;for(;i<text.length;){if(text[i]===close)return i+1;if(text[i]==='"'||text[i]==='{'||text[i]==='[')i=end(i);else i++;}throw new Error('Invalid configuration object');}
    let i=start;while(i<text.length&&!/[\s,}\]]/.test(text[i]))i++;return i;
  }
  const skip=start=>{while(/\s/.test(text[start]??'')&&start<text.length)start++;return start;};
  let offset=skip(text.indexOf('{')+1),range;const keys=new Set();
  while(text[offset]!=='}') {
    const keyEnd=end(offset),key=JSON.parse(text.slice(offset,keyEnd));
    if(keys.has(key))throw new Error('Duplicate project configuration field');keys.add(key);
    const start=skip(skip(keyEnd)+1),finish=end(start);
    if(key==='constitution')range=[start,finish];
    offset=skip(finish);if(text[offset]===',')offset=skip(offset+1);else break;
  }
  const value=JSON.stringify(pin);
  if(range)return text.slice(0,range[0])+value+text.slice(range[1]);
  return text.slice(0,offset)+`,\n  "constitution": ${value}\n`+text.slice(offset);
}

function rules(contract,measurements=[]) {
  return {minimumTarget:contract.minimumTarget,minimumFocusContrast:contract.minimumFocusContrast,
    measurements:Object.fromEntries(measurements.map(item=>[item.target,item.expected]))};
}
function candidateMeasurements(project,css,bundle) {
  const tokens=cssTokens(css),rules=bundle.files['accessibility/rules.json'];
  return project.config.measurements.map(item=>({...item,expected:expectedMeasurement(item,tokens,rules)}));
}
function differences(before,after,path='') {
  if(JSON.stringify(before)===JSON.stringify(after))return [];
  if(before&&after&&typeof before==='object'&&typeof after==='object')return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(key=>differences(before[key],after[key],path?`${path}.${key}`:key));
  return [{path,before:before??null,after:after??null}];
}
function sourceBinding(project,snapshot) {
  if(project.config.schemaVersion===1)return hash(JSON.stringify(snapshot.files));
  const files={...snapshot.files};
  if(project.config.constitution&&!project.config.identityFiles.includes(project.config.constitution.path))delete files[`identity/${project.config.constitution.path}`];
  return hash(JSON.stringify(files));
}

async function prepare(configPath,{snapshotPath,evidenceDirectory}={},allowPending=false) {
  const loc=await location(configPath,{evidenceDirectory});
  if(!allowPending&&await exists(loc.pending))throw new Error('Pending constitution adoption requires recovery before a new review');
  if(typeof snapshotPath!=='string'||!snapshotName.test(snapshotPath)||snapshotPath==='project.json')throw new Error('Choose an existing constitution snapshot JSON inside the project');
  const original=await fs.readFile(loc.configPath);const text=decode(original),config=JSON.parse(text);
  const running=config.schemaVersion===2;
  const project=running?await loadRunningProject(loc.configPath):await loadProject(loc.configPath);
  if(project.configHash!==hash(original))throw new Error('Configuration changed during constitution preview');
  const source=running?project.identity.before:await snapshotProject(project);
  const beforeContract=running?project.contract:source.contract;
  const fullSnapshot=resolve(loc.root,snapshotPath);
  if(!samePath(await fs.realpath(fullSnapshot),fullSnapshot))throw new Error('Unsafe constitution snapshot path or symlink');
  const snapshotInfo=await fs.lstat(fullSnapshot);
  if(!snapshotInfo.isFile()||snapshotInfo.isSymbolicLink()||snapshotInfo.size>5_000_000)throw new Error('Unsupported constitution snapshot or size');
  const bytes=await fs.readFile(fullSnapshot);if(bytes.length>5_000_000)throw new Error('Constitution snapshot too large');
  const pin={path:snapshotPath,sha256:hash(bytes)};
  const candidate=await loadPinnedConstitution(loc.root,pin);
  if(JSON.stringify(config.constitution)===JSON.stringify(pin))throw new Error('Project already uses this constitution pin');
  const afterMeasurements=running?candidateMeasurements(project,candidate.css,JSON.parse(decode(bytes))):[];
  const replacement=Buffer.from(pinConfig(text,pin));
  if(replacement.length>32_000)throw new Error('Configuration too large after constitution adoption');
  const afterConfig=JSON.parse(decode(replacement));delete afterConfig.constitution;
  const beforeConfig={...config};delete beforeConfig.constitution;
  if(JSON.stringify(afterConfig)!==JSON.stringify(beforeConfig))throw new Error('Adoption may change only the constitution pin');
  const before={pin:config.constitution??null,constitution:beforeContract.constitution,checkedRules:rules(beforeContract,project.measurements)};
  const after={pin,constitution:candidate.contract.constitution,checkedRules:rules(candidate.contract,afterMeasurements)};
  const preview={schemaVersion:1,before,after,checkedRuleDiff:differences(before.checkedRules,after.checkedRules),
    configDiff:{path:'constitution',before:before.pin,after:pin},
    binding:{configPath:loc.configPath,evidenceDirectory:loc.evidence,configurationSha256:hash(original),replacementConfigurationSha256:hash(replacement),snapshotSha256:pin.sha256,
      sourceSha256:sourceBinding(project,source),previousConstitutionSha256:beforeContract.specSha256,
      previousArtifactSha256:running?source.sha256:source.artifactSha256},
    requiresRecheck:true,claimBoundary:'Adoption changes the selected project pin. It does not recheck the UI or publish a constitution.'};
  preview.previewSha256=hash(JSON.stringify(preview));
  return {loc,preview,original,replacement};
}

export async function previewConstitutionAdoption(configPath,options) {
  return (await prepare(configPath,options)).preview;
}

export async function constitutionAdoptionStatus(configPath,{evidenceDirectory}={}) {
  const loc=await location(configPath,{evidenceDirectory,missing:true,allowHardlinks:true,requireSameFilesystem:false});
  if(!await exists(loc.pending))return {pending:false};
  const info=await fs.lstat(loc.pending);
  if(!info.isDirectory()||info.isSymbolicLink())return {pending:true,reason:'Pending adoption journal needs manual recovery review'};
  return {pending:true};
}

async function durable(path,bytes) {
  const file=await fs.open(path,'wx',0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
}
async function archive(loc,outcome) {
  const destination=resolve(loc.directory,`${outcome}-${randomUUID()}`);
  await fs.rename(loc.pending,destination);return resolve(destination,'journal.json');
}
async function restoreAbsent(loc) {
  const displaced=resolve(loc.pending,'displaced.json');
  if(await exists(displaced)&&!await exists(loc.configPath))await fs.link(displaced,loc.configPath);
}
async function unlinkMatching(path,expected) {
  if(await exists(path)&&hash(await fs.readFile(path))===expected)await fs.unlink(path);
}

export async function applyConstitutionAdoption(configPath,options,approvedSha256) {
  if(typeof approvedSha256!=='string'||!/^[a-f0-9]{64}$/.test(approvedSha256))throw new Error('Review and approve the exact constitution adoption SHA-256 first');
  const prepared=await prepare(configPath,options);const {loc,preview,original,replacement}=prepared;
  if(preview.previewSha256!==approvedSha256)throw new Error('Stale constitution adoption approval; review the current preview');
  await fs.mkdir(loc.directory,{recursive:true,mode:0o700});await location(configPath,{evidenceDirectory:options.evidenceDirectory});
  await fs.mkdir(loc.pending,{mode:0o700});
  const staged=resolve(loc.pending,'candidate.json'),displaced=resolve(loc.pending,'displaced.json');
  let installed=false,moved=false,journalWritten=false;
  try {
    const journal={schemaVersion:1,phase:'prepared',preview,original:original.toString('base64'),replacement:replacement.toString('base64')};
    await durable(resolve(loc.pending,'journal.json'),JSON.stringify(journal,null,2)+'\n');journalWritten=true;
    await durable(staged,replacement);
    const fresh=await prepare(configPath,options,true);
    if(fresh.preview.previewSha256!==approvedSha256)throw new Error('Stale constitution adoption approval before config write');
    await fs.rename(loc.configPath,displaced);moved=true;
    if(hash(await fs.readFile(displaced))!==hash(original))throw new Error('Configuration changed before adoption; external bytes preserved');
    // Hard-link creation is atomic and refuses an externally recreated config path.
    await fs.link(staged,loc.configPath);installed=true;
    await fs.unlink(staged);
    const current=await fs.readFile(loc.configPath);
    if(hash(current)!==hash(replacement))throw new Error('Configuration changed after adoption');
    const loaded=JSON.parse(decode(current)).schemaVersion===2?await loadRunningProject(loc.configPath):await loadProject(loc.configPath);
    if(loaded.configHash!==preview.binding.replacementConfigurationSha256)throw new Error('Configuration changed during adoption validation');
    const afterSnapshot=loaded.config.schemaVersion===1?await snapshotProject(loaded):loaded.identity.before;
    if(sourceBinding(loaded,afterSnapshot)!==preview.binding.sourceSha256)throw new Error('Project sources changed during adoption; recheck is required');
    await durable(resolve(loc.pending,'committed.json'),JSON.stringify({previewSha256:approvedSha256,configurationSha256:hash(replacement)})+'\n');
    const receiptPath=await archive(loc,'adopted');
    return {schemaVersion:1,previewSha256:approvedSha256,constitution:preview.after.constitution,pin:preview.after.pin,receiptPath,requiresRecheck:true};
  }catch(error) {
    // Before installation, put moved bytes back only when the config path is vacant.
    // After installation, retain the journal and require explicit recovery.
    if(!installed) {
      try {
        if(moved)await restoreAbsent(loc);
        if(!moved||await exists(loc.configPath)&&hash(await fs.readFile(loc.configPath))===hash(await fs.readFile(displaced))) {
          await unlinkMatching(staged,hash(replacement));
          if(moved)await fs.unlink(displaced);
          if(journalWritten)await archive(loc,'aborted');
          else {if(await exists(resolve(loc.pending,'journal.json')))await fs.unlink(resolve(loc.pending,'journal.json'));await fs.rmdir(loc.pending);}
        }
      }catch{/* Keep the durable journal and moved bytes for explicit recovery. */}
    }
    throw new Error(`${error.message}; ${await exists(loc.pending)?'pending adoption requires recovery at '+loc.pending:'configuration adoption was not applied'}`,{cause:error});
  }
}

/** Restore a pending operation; never replace a config with unrecognized bytes. */
export async function recoverConstitutionAdoption(configPath,{evidenceDirectory}={}) {
  const loc=await location(configPath,{evidenceDirectory,missing:true,allowHardlinks:true});
  const pendingInfo=await fs.lstat(loc.pending);
  if(!pendingInfo.isDirectory()||pendingInfo.isSymbolicLink())throw new Error('Unsafe pending adoption journal');
  const journalPath=resolve(loc.pending,'journal.json');const info=await fs.lstat(journalPath);
  if(!info.isFile()||info.isSymbolicLink()||info.size>200_000)throw new Error('Invalid adoption recovery journal');
  const journal=JSON.parse(await fs.readFile(journalPath,'utf8'));
  const original=Buffer.from(journal.original??'','base64'),replacement=Buffer.from(journal.replacement??'','base64');
  const preview=journal.preview,sha256=preview?.previewSha256,payload={...preview};delete payload.previewSha256;
  if(journal.schemaVersion!==1||journal.phase!=='prepared'||hash(JSON.stringify(payload))!==sha256||!samePath(preview.binding.configPath,loc.configPath)||!samePath(preview.binding.evidenceDirectory,loc.evidence)||hash(original)!==preview.binding.configurationSha256||hash(replacement)!==preview.binding.replacementConfigurationSha256||!original.length||original.length>32_000||replacement.length>32_000)throw new Error('Invalid adoption recovery binding');
  const displaced=resolve(loc.pending,'displaced.json'),staged=resolve(loc.pending,'candidate.json');
  let backupInfo,stagedInfo;
  if(await exists(displaced)) {
    backupInfo=await fs.lstat(displaced);
    if(!backupInfo.isFile()||backupInfo.isSymbolicLink()||hash(await fs.readFile(displaced))!==hash(original))throw new Error('Invalid adoption backup; retained all bytes');
  }
  if(await exists(staged)) {
    stagedInfo=await fs.lstat(staged);
    if(!stagedInfo.isFile()||stagedInfo.isSymbolicLink()||hash(await fs.readFile(staged))!==hash(replacement))throw new Error('Invalid staged adoption config');
  }
  if(await exists(loc.configPath)) {
    const current=hash(await fs.readFile(loc.configPath));
    if(current!==hash(original)&&current!==hash(replacement))throw new Error('Recovery refuses to overwrite external configuration changes');
    const currentInfo=await fs.lstat(loc.configPath);
    const companions=[[staged,stagedInfo,hash(replacement)],[displaced,backupInfo,hash(original)]].filter(([,entry,sha])=>entry&&sha===current&&entry.dev===currentInfo.dev&&entry.ino===currentInfo.ino);
    if(currentInfo.nlink!==1+companions.length)throw new Error('Recovery refuses unrecognized configuration hard links');
    // Only exact, journal-validated same-inode links left by our transaction qualify.
    for(const [path] of companions)await fs.unlink(path);
    if(current===hash(original))return {recovered:true,outcome:'original-restored',receiptPath:await archive(loc,'recovered'),requiresRecheck:true};
    const committed=resolve(loc.pending,'committed.json');
    if(await exists(committed)) {
      const committedInfo=await fs.lstat(committed);
      if(!committedInfo.isFile()||committedInfo.isSymbolicLink()||committedInfo.size>1000)throw new Error('Invalid adoption completion marker');
      const record=JSON.parse(await fs.readFile(committed,'utf8'));
      if(record.previewSha256!==sha256||record.configurationSha256!==hash(replacement))throw new Error('Invalid adoption completion binding');
      return {recovered:true,outcome:'adopted',receiptPath:await archive(loc,'adopted'),requiresRecheck:true};
    }
    if(!backupInfo)throw new Error('Missing adoption backup; retained installed config');
    // Move first, then verify; an intervening external change is retained, never overwritten.
    const held=resolve(loc.pending,`recovery-${randomUUID()}.json`);
    await fs.rename(loc.configPath,held);
    if(hash(await fs.readFile(held))!==hash(replacement)) {
      if(!await exists(loc.configPath))await fs.link(held,loc.configPath);
      throw new Error('Recovery detected an external configuration change; retained all bytes');
    }
  }
  const displacedInfo=await fs.lstat(displaced);
  if(!displacedInfo.isFile()||displacedInfo.isSymbolicLink())throw new Error('Invalid adoption backup');
  // Recovery installs only the exact journaled original, using exclusive creation.
  await fs.link(displaced,loc.configPath);await fs.unlink(displaced);
  return {recovered:true,outcome:'original-restored',receiptPath:await archive(loc,'recovered'),requiresRecheck:true};
}
