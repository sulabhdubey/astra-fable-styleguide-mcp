import {createHash,randomBytes} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,opendir,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,parse,sep,win32} from 'node:path';
import {compareReports} from './html-report.mjs';

const LIMIT=100,REPORT_BYTES=2_000_000,ENTRY_BYTES=16_000;
const statuses=['pass','fail','not_checked','unsupported'];
const digest=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value);
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const inside=(root,path)=>{const rel=relative(root,path);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../')&&!rel.startsWith('..\\');};
const checkKey=check=>json([check.ruleId,check.check,check.target,check.viewport?.width??null]);
const idPattern=/^[a-f0-9]{32}$/;
const forbidden=new Set(['__proto__','constructor','prototype','repair','receipt','receiptPath','original','replacement','source','sourceBody','sourceText','html','css']);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;

/** Check each path component; never follow a symlink/junction into the history store. */
async function directory(path,{create=false,allowMissing=false}={}) {
  let current=parse(path).root;
  for(const part of relative(current,path).split(sep).filter(Boolean)) {
    current=resolve(current,part);
    let info;
    try {info=await lstat(current);}
    catch(error) {
      if(error.code!=='ENOENT')throw error;
      if(!create){if(allowMissing)return false;throw new Error('History directory is missing');}
      try {await mkdir(current,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
      info=await lstat(current);
    }
    if(info.isSymbolicLink())throw new Error('Symlinks are unsupported in history paths');
    if(!info.isDirectory())throw new Error('History path must be a directory');
  }
  if(!samePath(await realpath(path),path))throw new Error('Symlinks are unsupported in history paths');
  return true;
}

function copyData(value,depth=0) {
  if(depth>10)throw new Error('History report nesting limit exceeded');
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Invalid report number');return value;}
  if(typeof value==='string'){if(value.length>32_000)throw new Error('History report field is too large');return value;}
  if(Array.isArray(value)){if(value.length>4_000)throw new Error('History report array limit exceeded');return value.map(item=>copyData(item,depth+1));}
  if(!plain(value))throw new Error('History report must contain JSON data only');
  if(Object.keys(value).length>4_000)throw new Error('History report object limit exceeded');
  return Object.fromEntries(Object.entries(value).filter(([key,item])=>!forbidden.has(key)&&item!==undefined).map(([key,item])=>[key,copyData(item,depth+1)]));
}
function pick(value,fields) {
  if(!plain(value))throw new Error('Invalid history report object');
  return Object.fromEntries(fields.filter(key=>value[key]!==undefined).map(key=>[key,copyData(value[key])]));
}
function projectName(value) {
  if(typeof value!=='string'||!value||value.length>500||isAbsolute(value)||win32.isAbsolute(value)||value.includes(':')||value.includes('\0'))throw new Error('Use a relative project path');
  const parts=value.replaceAll('\\','/').split('/');
  if(parts.some(part=>part==='..'||(part!=='.'&&(!part||/[. ]$/.test(part)))))throw new Error('Invalid project path');
  const name=parts.filter(part=>part!=='.').join('/')||'.';
  return process.platform==='win32'?name.toLowerCase():name;
}
function assertId(id){if(typeof id!=='string'||!idPattern.test(id))throw new Error('Invalid history ID');}
function countsFor(report){return Object.fromEntries(statuses.map(status=>[status,report.checks.filter(check=>check.status===status).length]));}
function cleanChecked(checked) {
  if(!plain(checked)||!plain(checked.result)||!plain(checked.result.report))throw new Error('Missing history report');
  const source=checked.result.report;
  if(!Array.isArray(source.checks)||source.checks.length>2_000)throw new Error('History checks limit exceeded');
  const report=pick(source,['schemaVersion','status','artifactSha256','specSha256','specHashScope','projectConfigurationSha256','constitution','limitations','browserScope']);
  report.checks=source.checks.map(check=>pick(check,['ruleId','check','target','status','selector','viewport','observed','expected','fix','limitation']));
  if(source.runningApp!==undefined)report.runningApp=pick(source.runningApp,['integration','viewports','journeyViewport']);
  if(!compareReports(report,report).compatible)throw new Error('Invalid or incomplete history report binding');
  if(!plain(checked.targetPaths))throw new Error('Invalid history target paths');
  const targetPaths=Object.fromEntries(Object.entries(checked.targetPaths).map(([target,path])=>{
    if(target.length>2_000||typeof path!=='string'||path.length>500||forbidden.has(target))throw new Error('Invalid history target path label');
    // These are display labels only. They are never resolved, read, or used to authorize writes.
    return [target,path];
  }));
  const summary={status:report.status,artifactSha256:report.artifactSha256,specSha256:report.specSha256,
    checks:report.checks.length,findings:report.checks.filter(check=>check.status!=='pass'),
    exitCode:report.checks.some(check=>['unsupported','not_checked'].includes(check.status))?2:report.status==='fail'?1:0};
  return {result:{report},summary,targetPaths};
}
function metadata(binding,checked,reportSha256) {
  const report=checked.result.report;
  return {id:binding.id,project:binding.project,createdAt:binding.createdAt,available:true,status:report.status,
    counts:countsFor(report),total:report.checks.length,artifactSha256:report.artifactSha256,specSha256:report.specSha256,
    projectConfigurationSha256:report.projectConfigurationSha256,reportSha256};
}
function coverage(checked) {
  const report=checked.result.report;
  // scrollWidth is a measured outcome; only viewport dimensions define coverage.
  return json({checks:report.checks.map(check=>[checkKey(check),check.selector??null,check.viewport?.width??null,check.viewport?.height??null]).sort((a,b)=>a[0].localeCompare(b[0])),
    browserScope:report.browserScope??null,runningApp:report.runningApp??null,
    targetPaths:Object.entries(checked.targetPaths).sort(([a],[b])=>a.localeCompare(b))});
}

async function boundedRead(path,limit) {
  const before=await lstat(path);
  if(before.isSymbolicLink()||!before.isFile()||before.nlink!==1)throw new Error('History files must be regular files without links');
  if(before.size>limit)throw new Error('History file exceeds its size limit');
  const flags=constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW??0);
  const handle=await open(path,flags);
  try {
    const opened=await handle.stat();
    if(opened.dev!==before.dev||opened.ino!==before.ino||!opened.isFile()||opened.nlink!==1)throw new Error('History file changed while opening');
    const buffer=Buffer.alloc(limit+1);let length=0;
    while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
    if(length>limit)throw new Error('History file exceeds its size limit');
    const after=await handle.stat(),pathAfter=await lstat(path);
    if(after.size!==length||after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs||pathAfter.isSymbolicLink()||pathAfter.dev!==opened.dev||pathAfter.ino!==opened.ino)throw new Error('History file changed while reading');
    return buffer.subarray(0,length).toString('utf8');
  } finally {await handle.close();}
}
async function exclusiveWrite(path,text) {
  const handle=await open(path,'wx',0o600);
  try {await handle.writeFile(text,'utf8');await handle.sync();}
  finally {await handle.close();}
}

/**
 * Local checksummed history is inspectable evidence, not a signature, live check,
 * repair packet, approval, or write authority. One Studio writer owns this store.
 * Files are never rotated/deleted; admission stops at 100 entries per project.
 */
export async function openStudioHistory({workspace,evidenceDirectory}) {
  if(typeof workspace!=='string'||typeof evidenceDirectory!=='string')throw new Error('History workspace and evidence directory are required');
  const root=resolve(workspace),evidence=resolve(evidenceDirectory);
  await directory(root);await directory(evidence);
  if(inside(root,evidence))throw new Error('History evidence directory must be outside the workspace');
  const workspaceSha256=digest(process.platform==='win32'?root.toLowerCase():root);
  let saveQueue=Promise.resolve();
  async function context(project,{create=false}={}) {
    const name=projectName(project),projectPath=resolve(root,name);
    if(!inside(root,projectPath))throw new Error('Project path escapes workspace');
    await directory(root);await directory(projectPath);await directory(evidence);
    const projectSha256=digest(name),path=resolve(evidence,'studio-history-v1',workspaceSha256,projectSha256);
    const exists=await directory(path,{create,allowMissing:!create});
    return {project:name,workspaceSha256,projectSha256,path,exists};
  }
  async function scan(ctx) {
    if(!ctx.exists)return [];
    await directory(ctx.path);
    const ids=new Set();let files=0;
    const dir=await opendir(ctx.path);
    for await(const entry of dir) {
      if(++files>LIMIT*2)throw new Error('History storage exceeds the 100-entry limit');
      const match=/^([a-f0-9]{32})\.(entry|report)\.json$/.exec(entry.name);
      if(!match)throw new Error('Unexpected file in history storage; inspect the local evidence directory');
      ids.add(match[1]);if(ids.size>LIMIT)throw new Error('History storage exceeds the 100-entry limit');
    }
    await directory(ctx.path);
    return [...ids];
  }
  async function load(ctx,id) {
    assertId(id);
    try {
      if(!ctx.exists)throw new Error('Missing history entry');
      await directory(ctx.path);
      const raw=await boundedRead(resolve(ctx.path,id+'.entry.json'),ENTRY_BYTES),envelope=JSON.parse(raw);
      if(!plain(envelope)||!plain(envelope.payload)||digest(json(envelope.payload))!==envelope.sha256||Object.keys(envelope).length!==2)throw new Error('History metadata integrity mismatch');
      const payload=envelope.payload;
      const expected={schemaVersion:1,kind:'stylecon-studio-history',workspaceSha256:ctx.workspaceSha256,projectSha256:ctx.projectSha256,id,project:ctx.project};
      if(Object.entries(expected).some(([key,value])=>payload[key]!==value)||typeof payload.createdAt!=='string'||!Number.isFinite(Date.parse(payload.createdAt))||new Date(payload.createdAt).toISOString()!==payload.createdAt)throw new Error('History identity binding mismatch');
      const recordText=await boundedRead(resolve(ctx.path,id+'.report.json'),REPORT_BYTES);
      if(digest(recordText)!==payload.entry?.reportSha256)throw new Error('History report integrity mismatch');
      const record=JSON.parse(recordText);
      const binding={...expected,createdAt:payload.createdAt};
      if(!plain(record)||Object.entries(binding).some(([key,value])=>record[key]!==value))throw new Error('History report identity binding mismatch');
      const checked=cleanChecked(record.checked),entry=metadata(binding,checked,digest(recordText));
      if(json(record)!==json({...binding,checked})||json(payload)!==json({...binding,entry}))throw new Error('Invalid history evidence structure');
      await directory(ctx.path);
      return {entry,checked,historyOnly:true};
    } catch(error) {
      throw new Error('History entry unavailable: '+(error.code==='ENOENT'?'missing local evidence':error.message));
    }
  }
  async function saveNow({project,checked}) {
    const safe=cleanChecked(checked),ctx=await context(project,{create:true});
    const ids=await scan(ctx);if(ids.length>=LIMIT)throw new Error('History capacity is 100 entries. Select another evidence directory to preserve additional checks; existing files were retained.');
    const id=randomBytes(16).toString('hex'),binding={schemaVersion:1,kind:'stylecon-studio-history',workspaceSha256:ctx.workspaceSha256,projectSha256:ctx.projectSha256,id,project:ctx.project,createdAt:new Date().toISOString()};
    const record=json({...binding,checked:safe})+'\n';
    if(Buffer.byteLength(record)>REPORT_BYTES)throw new Error('History report exceeds the size limit');
    const entry=metadata(binding,safe,digest(record)),payload={...binding,entry},recordMetadata=json({payload,sha256:digest(json(payload))})+'\n';
    if(Buffer.byteLength(recordMetadata)>ENTRY_BYTES)throw new Error('History metadata exceeds the size limit');
    // Exclusive, synced writes; an interrupted pair remains an unavailable entry.
    // Retain partial files for inspection. Never erase evidence to hide a failed save.
    await directory(ctx.path);await exclusiveWrite(resolve(ctx.path,id+'.report.json'),record);
    await directory(ctx.path);await exclusiveWrite(resolve(ctx.path,id+'.entry.json'),recordMetadata);
    const verified=await load(ctx,id);return verified.entry;
  }
  return {
    save(options) {
      const result=saveQueue.then(()=>saveNow(options));
      saveQueue=result.catch(()=>{});return result;
    },
    async list({project}) {
      const ctx=await context(project),ids=await scan(ctx),entries=[];
      for(const id of ids) {
        try {entries.push((await load(ctx,id)).entry);}
        catch(error){entries.push({id,project:ctx.project,available:false,status:'unavailable',reason:error.message});}
      }
      entries.sort((a,b)=>(b.createdAt??'').localeCompare(a.createdAt??'')||a.id.localeCompare(b.id));
      return {project:ctx.project,entries,limit:LIMIT,unavailableCount:entries.filter(entry=>!entry.available).length};
    },
    async read({project,id}) {assertId(id);return load(await context(project),id);},
    async compare({project,baseId,headId}) {
      assertId(baseId);assertId(headId);
      const ctx=await context(project),base=await load(ctx,baseId),head=await load(ctx,headId);
      const current=head.checked.result.report,previous=base.checked.result.report;
      const result=compareReports(current,previous),binding={baseId,headId,historyOnly:true};
      if(!result.compatible)return {...binding,...result,exitCode:2};
      if(coverage(base.checked)!==coverage(head.checked))return {...binding,compatible:false,reason:'The recorded check coverage or browser scope differs.',exitCode:2};
      const prior=new Map(previous.checks.map(check=>[checkKey(check),check]));
      const newViolations=current.checks.filter(check=>check.status==='fail'&&prior.get(checkKey(check)).status!=='fail');
      const existingViolations=current.checks.filter(check=>check.status==='fail'&&prior.get(checkKey(check)).status==='fail');
      const resolved=current.checks.filter(check=>check.status==='pass'&&prior.get(checkKey(check)).status==='fail');
      const incomplete=current.checks.filter(check=>['not_checked','unsupported'].includes(check.status));
      const unresolvedViolations=incomplete.filter(check=>prior.get(checkKey(check)).status==='fail');
      const counts={newViolations:newViolations.length,existingViolations:existingViolations.length,resolved:resolved.length,incomplete:incomplete.length,unresolvedViolations:unresolvedViolations.length,
        priorIncomplete:previous.checks.filter(check=>['not_checked','unsupported'].includes(check.status)).length};
      return {...binding,...result,newViolations,existingViolations,resolved,incomplete,unresolvedViolations,counts,exitCode:incomplete.length?2:newViolations.length||existingViolations.length?1:0};
    }
  };
}
