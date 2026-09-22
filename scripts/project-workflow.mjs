import { TextDecoder } from 'node:util';
import { readFile, realpath, stat, writeFile, rename, unlink, open } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createContract } from '../packages/browser-verification/src/index.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const safePath = path => typeof path === 'string' && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(html|css|js)$/.test(path);
const selector = value => typeof value === 'string' && /^#[A-Za-z][\w-]*$/.test(value);
async function contained(root,path) {
  if (!safePath(path)) throw new Error('Unsafe project path');
  const full = await realpath(resolve(root,path)); const rel = relative(root,full);
  if (rel.startsWith('..') || isAbsolute(rel) || rel.replaceAll('\\','/').toLowerCase()!==path.toLowerCase()) throw new Error('Unsafe project symlink');
  const info = await stat(full);
  if (!info.isFile() || info.size > 1_000_000) throw new Error('Unsupported project file');
  return full;
}
export async function loadProject(configPath) {
  const full = await realpath(configPath); const root = await realpath(dirname(full));
  const raw = await readFile(full,'utf8'); if (raw.length > 32000) throw new Error('Configuration too large');
  const config = JSON.parse(raw); const j = config.journey;
  if(Object.keys(config).some(k=>!['schemaVersion','files','journey','targetPaths','form','states','closePaths'].includes(k))) throw new Error('Unknown project configuration field');
  if(j && Object.keys(j).some(k=>!['buttons','trigger','dialog','name','dialogButtons','close','escapeAllowed','exceptionReason'].includes(k))) throw new Error('Unknown journey field');
  if(config.schemaVersion!==1 || !Array.isArray(config.files) || config.files.length<1 || config.files.length>20 || !config.files.includes('index.html') || new Set(config.files).size!==config.files.length) throw new Error('Invalid project files');
  for(const path of config.files) { if(path==='tokens.css') throw new Error('Reserved canonical CSS route'); await contained(root,path); }
  if(!j || !Array.isArray(j.buttons) || !j.buttons.length || !Array.isArray(j.dialogButtons) || !j.dialogButtons.length || [...j.buttons,...j.dialogButtons,j.trigger,j.dialog,j.close].some(s=>!selector(s)) || typeof j.name!=='string' || !j.name.trim()) throw new Error('Invalid configured journey');
  if(j.buttons.length+j.dialogButtons.length>20) throw new Error('Too many targets');
  if(!j.buttons.includes(j.trigger)||!j.dialogButtons.includes(j.close)) throw new Error('Trigger and close must be configured button targets');
  if(j.escapeAllowed===false && !j.exceptionReason?.trim()) throw new Error('Missing Escape exception');
  if(config.closePaths && (!Array.isArray(config.closePaths)||config.closePaths.length>5||config.closePaths.some(s=>!selector(s)||!j.dialogButtons.includes(s)))) throw new Error('Invalid close path');
  for(const target of [...j.buttons,...j.dialogButtons,'dialog',...(config.form?[config.form.input]:[]),...(config.states??[]).map(s=>s.selector),'page']) {
    if(!config.files.includes(config.targetPaths?.[target])) throw new Error('Missing target source mapping');
  }
  if(config.form && (![config.form.input,config.form.submit].every(selector) || typeof config.form.invalidValue!=='string' || typeof config.form.validValue!=='string')) throw new Error('Invalid form contract');
  for(const state of config.states??[]) if(!selector(state.selector) || !['disabled','loading'].includes(state.kind)) throw new Error('Invalid state contract');
  if(config.form && Object.keys(config.form).some(k=>!['input','submit','invalidValue','validValue'].includes(k))) throw new Error('Unknown form field');
  for(const state of config.states??[]) if(Object.keys(state).some(k=>!['selector','kind'].includes(k))) throw new Error('Unknown state field');
  if(Object.values(config.targetPaths).some(p=>!config.files.includes(p))) throw new Error('Invalid target source mapping');
  return {root,configPath:full,config,configHash:hash(raw)};
}
export async function snapshotProject(project) {
  if(hash(await readFile(project.configPath,'utf8'))!==project.configHash) throw new Error('Configuration changed; reload project');
  const files={}; for(const path of project.config.files) files[path]=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await readFile(await contained(project.root,path)));
  const css=await readFile(resolve(repository,'generated/css/tokens.css'),'utf8');
  const [button,dialog,rules]=await Promise.all(['spec/components/button.json','spec/components/dialog.json','spec/accessibility/rules.json'].map(async p=>JSON.parse(await readFile(resolve(repository,p),'utf8'))));
  const contract=createContract({button,dialog,rules});
  return {artifactSha256:hash(JSON.stringify({configHash:project.configHash,files,css})),contract,files,css,config:project.config};
}
async function withRepairLock(project,action) {
  const lockPath=resolve(project.root,'.style-repair.lock');
  const lock=await open(lockPath,'wx');
  try {await lock.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));await lock.sync();return await action();}
  finally {await lock.close();await unlink(lockPath);}
}
export async function previewRepair(project,packet,change) {
  if(!project.config.files.includes(change.path) || !packet.findings?.some(f=>f.path===change.path && f.status==='fail')) throw new Error('Repair path is not allowed by findings');
  const before=await snapshotProject(project);
  if(packet.artifactSha256!==before.artifactSha256 || packet.specSha256!==before.contract.specSha256) throw new Error('Stale repair evidence');
  if(typeof change.before!=='string' || !change.before || typeof change.after!=='string' || change.before===change.after || before.files[change.path].split(change.before).length!==2) throw new Error('Repair must match exactly once and change content');
  const original=before.files[change.path];
  const replacement=original.replace(change.before,()=>change.after);
  if(Buffer.byteLength(replacement)>1_000_000) throw new Error('Repair too large');
  const files={...before.files,[change.path]:replacement};
  return {schemaVersion:1,configHash:project.configHash,path:change.path,specSha256:before.contract.specSha256,
    previousArtifactSha256:before.artifactSha256,artifactSha256:hash(JSON.stringify({configHash:project.configHash,files,css:before.css})),
    original,replacement,originalSha256:hash(original),replacementSha256:hash(replacement),
    diff:{path:change.path,before:change.before,after:change.after},requiresBrowserRecheck:true};
}
async function receiptRoot(project,directory) {
  if(typeof directory!=='string'||!isAbsolute(directory)) throw new Error('An absolute private receipt directory is required');
  const root=await realpath(directory);const rel=relative(project.root,root);
  if(!rel || (!(rel==='..'||rel.startsWith('..'+sep))&&!isAbsolute(rel))) throw new Error('Receipts must be outside the served project');
  if(!(await stat(root)).isDirectory()) throw new Error('Invalid receipt directory');
  return root;
}
async function writeDurably(path,content) {
  const file=await open(path,'wx',0o600);
  try {await file.writeFile(content);await file.sync();}
  catch(error){await file.close();await unlink(path);throw error;}
  await file.close();
}
async function commitRepair(project,preview,directory) {
  const root=await receiptRoot(project,directory);
  const receiptPath=resolve(root,`repair-${randomUUID()}.json`);
  // Immutable prepared journal is durable before any source mutation. It does not claim success.
  await writeDurably(receiptPath,JSON.stringify({...preview,phase:'prepared'},null,2));
  const path=await contained(project.root,preview.path);const temp=`${path}.${randomUUID()}.tmp`;
  let staged=false;
  try {
    await writeDurably(temp,preview.replacement);staged=true;
    const current=await snapshotProject(project);
    if(current.artifactSha256!==preview.previousArtifactSha256||current.contract.specSha256!==preview.specSha256) throw new Error('Stale repair evidence');
    await rename(temp,path);staged=false;
  } finally {if(staged)await unlink(temp);}
  const after=await snapshotProject(project);
  if(after.artifactSha256!==preview.artifactSha256||after.contract.specSha256!==preview.specSha256) throw new Error(`Post-write conflict; recovery receipt: ${receiptPath}`);
  return {previousArtifactSha256:preview.previousArtifactSha256,artifactSha256:after.artifactSha256,path:preview.path,receiptPath,requiresBrowserRecheck:true};
}
export async function applyRepair(project,packet,change,{receiptDirectory}={}) {
  return withRepairLock(project,async()=>commitRepair(project,await previewRepair(project,packet,change),receiptDirectory));
}
export async function undoRepair(project,receiptPath,{receiptDirectory}={}) {
  return withRepairLock(project,async()=>{
    const directory=await receiptRoot(project,receiptDirectory);
    const receipt=await realpath(receiptPath);const receiptRelative=relative(directory,receipt);
    if(!receiptRelative||receiptRelative==='..'||receiptRelative.startsWith('..'+sep)||isAbsolute(receiptRelative))throw new Error('Receipt is outside the private receipt directory');
    const info=await stat(receipt);if(!info.isFile()||info.size>15_000_000)throw new Error('Invalid repair receipt');
    const record=JSON.parse(await readFile(receipt,'utf8'));
    if(record.schemaVersion!==1||record.phase!=='prepared'||record.configHash!==project.configHash||!project.config.files.includes(record.path)||typeof record.original!=='string'||typeof record.replacement!=='string'||Buffer.byteLength(record.original)>1_000_000||hash(record.original)!==record.originalSha256||hash(record.replacement)!==record.replacementSha256)throw new Error('Invalid repair receipt');
    const current=await snapshotProject(project);
    if(current.artifactSha256!==record.artifactSha256||current.contract.specSha256!==record.specSha256||current.files[record.path]!==record.replacement)throw new Error('Stale undo evidence');
    const restored={...current.files,[record.path]:record.original};
    if(hash(JSON.stringify({configHash:project.configHash,files:restored,css:current.css}))!==record.previousArtifactSha256)throw new Error('Invalid original snapshot');
    return commitRepair(project,{...record,previousArtifactSha256:record.artifactSha256,artifactSha256:record.previousArtifactSha256,original:record.replacement,replacement:record.original,originalSha256:record.replacementSha256,replacementSha256:record.originalSha256,diff:{path:record.path,before:record.replacement,after:record.original}},receiptDirectory);
  });
}
export async function startProjectServer(project,port=0) {
  const server=createServer(async(request,response)=>{
    const host=`127.0.0.1:${server.address().port}`;
    if(request.headers.host!==host || (request.headers.origin && request.headers.origin!==`http://${host}`) || request.headers['sec-fetch-site']==='cross-site') {response.writeHead(403);response.end();return;}
    if(request.method!=='GET'){response.writeHead(405);response.end();return;}
    try {
      const url=new URL(request.url,'http://127.0.0.1'); const snapshot=await snapshotProject(project);
      response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
      response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
      if(url.pathname==='/_verification'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({artifactSha256:snapshot.artifactSha256,contract:snapshot.contract,config:snapshot.config}));return;}
      const path=url.pathname==='/'?'index.html':url.pathname.slice(1);
      const content=path==='tokens.css'?snapshot.css:Object.hasOwn(snapshot.files,path)?snapshot.files[path]:undefined;
      if(content===undefined){response.writeHead(404);response.end();return;}
      response.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':'text/html; charset=utf-8');response.end(content);
    }catch{response.writeHead(409);response.end('Project snapshot unavailable');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return server;
}
if(typeof process!=='undefined' && process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const project=await loadProject(process.argv[2]);const server=await startProjectServer(project,Number(process.argv[3]??0));console.log(`Project preview: http://127.0.0.1:${server.address().port}`);
}
