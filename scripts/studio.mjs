import {createServer} from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,readdir,realpath,stat} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runCheck,formatReport} from './standalone-check.mjs';
import {loadProject,previewRepair,applyRepair,undoRepair} from './project-workflow.mjs';
import {previewRunningRepair,applyRunningRepair,undoRunningRepair} from './running-repair.mjs';
import {initProject} from './project-init.mjs';
import {importCssSuggestions,createConstitutionCandidate,exportConstitutionCandidate,getConstitutionAuthoringCatalog} from './constitution-authoring.mjs';

const assets=fileURLToPath(new URL('../packages/cli/studio/',import.meta.url));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const inside=(root,path)=>{const rel=relative(root,path);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../')&&!rel.startsWith('..\\');};
const assetTypes={'/':'text/html; charset=utf-8','/app.mjs':'text/javascript; charset=utf-8','/style.css':'text/css; charset=utf-8'};

/** All actions are explicitly requested locally; no workspace code or shell commands run here. */
export async function startStudio({workspace,evidenceDirectory,port=0,check=runCheck}) {
  const root=await realpath(resolve(workspace)),evidence=await realpath(resolve(evidenceDirectory));
  if(!(await stat(root)).isDirectory()||!(await stat(evidence)).isDirectory()||inside(root,evidence))throw new Error('Evidence directory must exist outside the selected workspace');
  const token=randomBytes(32).toString('hex');const sessions=new Map();let busy=false,origin;
  async function pathWithin(value,{newPath=false}={}) {
    if(typeof value!=='string'||value.length>500||isAbsolute(value)||value.split(/[\\/]/).includes('..'))throw new Error('Use a relative path inside the selected workspace');
    const path=resolve(root,value);
    if(!inside(root,path))throw new Error('Path escapes the workspace');
    const actual=await realpath(newPath?dirname(path):path);
    if(!inside(root,actual)||actual.toLowerCase()!==(newPath?dirname(path):path).toLowerCase())throw new Error('Symlinks are unsupported');
    return path;
  }
  async function discover() {
    const projects=[];let visited=0;
    async function walk(path,depth=0) {
      if(depth>3||visited++>120||projects.length>=40)return;
      const entries=await readdir(path,{withFileTypes:true});
      if(entries.some(e=>e.isFile()&&e.name==='project.json'))projects.push({path:relative(root,path).replaceAll('\\','/')||'.',configured:true});
      else if(entries.some(e=>e.isFile()&&e.name==='index.html'))projects.push({path:relative(root,path).replaceAll('\\','/')||'.',configured:false});
      for(const entry of entries)if(entry.isDirectory()&&!entry.isSymbolicLink()&&!entry.name.startsWith('.')&&!['node_modules','dist','generated'].includes(entry.name))await walk(resolve(path,entry.name),depth+1);
    }
    await walk(root);return {projects};
  }
  async function act(body) {
    if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Invalid request');
    if(body.action==='projects')return discover();
    if(body.action==='import')return importCssSuggestions(body.css);
    if(body.action==='catalog') {
      const catalog=await getConstitutionAuthoringCatalog(await pathWithin(body.source));
      return {...catalog,items:[...catalog.tokenPaths,{...catalog.buttonMinimumTarget,type:'dimension'}]};
    }
    if(body.action==='candidate') {
      const source=await pathWithin(body.source);const candidate=await createConstitutionCandidate(source,{changes:body.changes,exceptions:body.exceptions});
      sessions.set('constitution',{source,candidate});return {candidateSha256:candidate.candidateSha256,beforeAfterDiff:candidate.beforeAfterDiff,exceptions:candidate.exceptions};
    }
    if(body.action==='export') {
      const state=sessions.get('constitution');if(!state)throw new Error('Review a candidate first');
      const destination=await pathWithin(body.destination,{newPath:true});
      const result=await exportConstitutionCandidate(state.source,state.candidate,body.candidateSha256,destination);sessions.delete('constitution');return result;
    }
    const projectDirectory=await pathWithin(body.project);const config=resolve(projectDirectory,'project.json');
    if(body.action==='init') {const result=await initProject(projectDirectory,body.options);sessions.delete(projectDirectory);return result;}
    await pathWithin(relative(root,config));
    if(body.action==='config') {const raw=await readFile(config,'utf8');if(raw.length>32_000)throw new Error('Configuration too large');return JSON.parse(raw);}
    const state=sessions.get(projectDirectory)??{};
    const running=JSON.parse(await readFile(config,'utf8')).schemaVersion===2;
    if(body.action==='check') {
      const checked=await check(config);
      const id=randomBytes(10).toString('hex');
      await writeFile(resolve(evidence,id+'.json'),JSON.stringify(checked.result,null,2)+'\n',{flag:'wx',mode:0o600});
      await writeFile(resolve(evidence,id+'.html'),formatReport(checked.result,checked.targetPaths,'html'),{flag:'wx',mode:0o600});
      sessions.set(projectDirectory,{...checked,receipt:state.receipt});return {...checked,reportFile:id+'.html'};
    }
    if(body.action==='undo') {
      if(!state.receipt)throw new Error('No correction from this session is available to undo');
      const result=running?await undoRunningRepair(config,state.receipt,{receiptDirectory:evidence}):await undoRepair(await loadProject(config),state.receipt,{receiptDirectory:evidence});sessions.delete(projectDirectory);return result;
    }
    if(!state.result?.repair)throw new Error('Run a check with a supported mapped repair first');
    const project=running?config:await loadProject(config);
    const previewAction=running?previewRunningRepair:previewRepair,applyAction=running?applyRunningRepair:applyRepair;
    if(body.action==='preview') {
      const preview=await previewAction(project,state.result.repair,body.change);state.preview=preview;state.change=body.change;state.previewSha256=hash(preview);sessions.set(projectDirectory,state);
      return {diff:preview.diff,previewSha256:state.previewSha256};
    }
    if(body.action==='apply') {
      if(!state.preview||body.previewSha256!==state.previewSha256)throw new Error('Review the exact correction preview before applying');
      const fresh=await previewAction(project,state.result.repair,state.change);if(hash(fresh)!==state.previewSha256)throw new Error('Correction changed; review again');
      const result=await applyAction(project,state.result.repair,state.change,{receiptDirectory:evidence});sessions.set(projectDirectory,{receipt:result.receiptPath});return {requiresBrowserRecheck:true,requiresRebuild:result.requiresRebuild??false};
    }
    throw new Error('Unknown action');
  }
  const server=createServer(async(req,res)=>{
    const send=(status,value,type='application/json; charset=utf-8')=>{res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});res.end(typeof value==='string'?value:JSON.stringify(value));};
    if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin)||['cross-site','same-site'].includes(req.headers['sec-fetch-site']))return send(403,{error:'Local origin required'});
    if(req.method==='GET'&&Object.hasOwn(assetTypes,req.url)){try{return send(200,await readFile(resolve(assets,req.url==='/'?'index.html':req.url.slice(1)),'utf8'),assetTypes[req.url]);}catch{return send(500,{error:'Studio assets unavailable'});}}
    if(req.url!=='/api')return send(404,{error:'Not found'});
    const provided=Buffer.from(String(req.headers['x-stylecon-session']??''));const expected=Buffer.from(token);
    if(req.method!=='POST'||req.headers['content-type']!=='application/json'||req.headers.origin!==origin||provided.length!==expected.length||!timingSafeEqual(provided,expected))return send(403,{error:'Authenticated local request required'});
    if(busy)return send(409,{error:'An action is running. Wait for its result.'});busy=true;
    try {
      let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>1_100_000)throw new Error('Request too large');chunks.push(chunk);}
      const result=await act(JSON.parse(Buffer.concat(chunks).toString('utf8')));send(200,result);
    }catch(error){send(400,{error:error.message});}finally{busy=false;}
  });
  server.requestTimeout=15_000;server.headersTimeout=10_000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {server,origin,token,url:origin+'/#'+token,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
