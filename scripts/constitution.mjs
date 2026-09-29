import {readFile, readdir, realpath, stat, writeFile} from 'node:fs/promises';
import {resolve, relative, isAbsolute, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {evaluateSpec} from '../dist/packages/evaluator/src/index.js';
import {canonicalize, mergeObjects} from '../dist/packages/style-spec/src/index.js';
import {compileCss} from '../dist/packages/token-compiler/src/index.js';
import {createContract} from '../packages/browser-verification/src/index.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fileName=/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.json$/;
function safeJson(value) {
  if(value&&typeof value==='object') for(const key of Object.keys(value)) {
    if(['__proto__','constructor','prototype'].includes(key))throw new Error('Unsafe constitution object key');
    safeJson(value[key]);
  }
}

export function validateConstitution(bundle) {
  if(!bundle||bundle.schemaVersion!==1||!bundle.files||Array.isArray(bundle.files)||Object.keys(bundle).some(k=>!['schemaVersion','files'].includes(k)))throw new Error('Invalid constitution snapshot');
  const files=bundle.files, names=Object.keys(files);
  if(!names.length||names.length>100||names.some(name=>!fileName.test(name)))throw new Error('Invalid constitution files');
  safeJson(files);
  for(const name of ['manifest.json','principles.json','components/button.json','components/dialog.json','accessibility/rules.json'])if(!files[name])throw new Error(`Missing canonical document: ${name}`);
  const manifest=files['manifest.json'];
  if(typeof manifest.name!=='string'||!manifest.name.trim()||manifest.name.length>160||typeof manifest.version!=='string'||!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version))throw new Error('Invalid constitution identity');
  const tokens={};
  for(const name of names.filter(p=>p.startsWith('tokens/')).sort())mergeObjects(tokens,files[name]);
  if(!Object.keys(tokens).length)throw new Error('Missing constitution tokens');
  const group=prefix=>names.filter(name=>name.startsWith(prefix)).sort().map(name=>files[name]);
  const evaluation=evaluateSpec({manifest,tokens,components:group('components/'),patterns:group('patterns/'),accessibility:files['accessibility/rules.json']});
  if(!evaluation.valid)throw new Error(`Invalid constitution: ${evaluation.issues.filter(i=>i.severity==='error').map(i=>`${i.code} ${i.path}`).join('; ')}`);
  const contract=createContract({button:files['components/button.json'],dialog:files['components/dialog.json'],rules:files['accessibility/rules.json']});
  const css=compileCss(tokens);
  // CSS is generated from validated source, never accepted as an independent snapshot field.
  if(css.includes('<')||css.includes('>')||css.includes('@import')||/url\s*\(/i.test(css))throw new Error('Unsupported executable or external CSS token');
  return {contract,css,name:manifest.name,version:manifest.version};
}

export async function pinConstitution(sourceRoot,outputPath) {
  const root=await realpath(resolve(sourceRoot,'spec'));const files={};let total=0;
  const outputParent=await realpath(dirname(resolve(outputPath)));
  const destination=relative(root,outputParent);
  if(!isAbsolute(destination)&&destination!=='..'&&!destination.startsWith('..\\')&&!destination.startsWith('../'))throw new Error('Export snapshots outside the canonical spec directory');
  async function visit(prefix='') {
    const entries=await readdir(resolve(root,prefix),{withFileTypes:true});
    for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
      if(entry.isSymbolicLink())throw new Error('Constitution symlinks are unsupported');
      const name=prefix+entry.name;
      if(entry.isDirectory()){if(prefix.split('/').length>5)throw new Error('Constitution nesting too deep');await visit(name+'/');}
      else if(entry.isFile()&&name.endsWith('.json')) {
        if(!fileName.test(name)||Object.keys(files).length>=100)throw new Error('Unsupported constitution file');
        const info=await stat(resolve(root,name));total+=info.size;
        if(info.size>1_000_000||total>5_000_000)throw new Error('Constitution too large');
        files[name]=JSON.parse(await readFile(resolve(root,name),'utf8'));
      }
    }
  }
  await visit();
  const bundle={schemaVersion:1,files};const identity=validateConstitution(bundle);
  const bytes=canonicalize(bundle)+'\n';
  await writeFile(outputPath,bytes,{flag:'wx',mode:0o600});
  return {sha256:digest(bytes),name:identity.name,version:identity.version};
}

export async function loadPinnedConstitution(root,pin) {
  if(!pin||Object.keys(pin).some(k=>!['path','sha256'].includes(k))||typeof pin.path!=='string'||!fileName.test(pin.path)||!/^([a-f0-9]{64})$/.test(pin.sha256))throw new Error('Invalid constitution pin');
  const path=await realpath(resolve(root,pin.path));const rel=relative(root,path).replaceAll('\\','/');
  if(isAbsolute(rel)||rel.startsWith('..')||rel.toLowerCase()!==pin.path.toLowerCase())throw new Error('Unsafe constitution path or symlink');
  const info=await stat(path);if(!info.isFile()||info.size>5_000_000)throw new Error('Constitution too large');
  const bytes=await readFile(path);if(digest(bytes)!==pin.sha256)throw new Error('Constitution pin changed: review and explicitly repin the snapshot');
  const {contract,css,name,version}=validateConstitution(JSON.parse(bytes.toString('utf8')));
  return {css,contract:{...contract,specSha256:pin.sha256,specHashScope:'SHA-256 of the complete pinned canonical snapshot',constitution:{name,version,sha256:pin.sha256}}};
}
