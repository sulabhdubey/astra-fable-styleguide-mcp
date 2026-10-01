import {mkdir, readFile, readdir, realpath, lstat, writeFile} from 'node:fs/promises';
import {basename, dirname, isAbsolute, relative, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalize, deepClone, getPath} from '../dist/packages/style-spec/src/index.js';
import {validateConstitution} from './constitution.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const fileName=/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.json$/;
const unsafe=new Set(['__proto__','constructor','prototype']);
const tokenRoots=new Set(['color','semantic','typography','space']);

function assertSafe(value) {
  if (value&&typeof value==='object') for (const [key,child] of Object.entries(value)) {
    if (unsafe.has(key)) throw new Error('Unsafe constitution object key');
    assertSafe(child);
  }
}

function inside(parent, child) {
  const path=relative(parent,child);
  return !isAbsolute(path)&&path!==''&&!path.startsWith('..\\')&&!path.startsWith('../')&&path!=='..';
}

async function readBundle(sourceRoot) {
  const sourcePath=resolve(sourceRoot);
  if ((await lstat(sourcePath)).isSymbolicLink()) throw new Error('Canonical source root symlinks are unsupported');
  const root=await realpath(sourcePath);
  const specPath=resolve(root,'spec');
  if ((await lstat(specPath)).isSymbolicLink()) throw new Error('Canonical spec symlinks are unsupported');
  const spec=await realpath(specPath);
  if (!inside(root,spec)) throw new Error('Canonical spec must be inside the source repository');
  const files={}; let total=0;
  async function visit(prefix='') {
    const entries=await readdir(resolve(spec,prefix),{withFileTypes:true});
    for (const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error('Constitution symlinks are unsupported');
      const name=prefix+entry.name;
      if (entry.isDirectory()) {
        if (prefix.split('/').length>5) throw new Error('Constitution nesting too deep');
        await visit(name+'/');
      } else if (entry.isFile()&&name.endsWith('.json')) {
        if (!fileName.test(name)||Object.keys(files).length>=100) throw new Error('Unsupported constitution file');
        const text=await readFile(resolve(spec,name),'utf8'); total+=Buffer.byteLength(text);
        if (total>5_000_000||Buffer.byteLength(text)>1_000_000) throw new Error('Constitution too large');
        files[name]=JSON.parse(text);
      }
    }
  }
  await visit(); assertSafe(files);
  const bundle={schemaVersion:1,files};
  validateConstitution(bundle);
  return {root,spec,bundle,sha256:digest(canonicalize(bundle)+'\n')};
}

function tokenFile(files, root) {
  const matches=Object.entries(files).filter(([name,value])=>name.startsWith('tokens/')&&value&&typeof value==='object'&&Object.hasOwn(value,root));
  if (matches.length!==1) throw new Error(`Unknown canonical token root: ${root}`);
  return matches[0][0];
}

function allowableChange(change, files) {
  if (!change||typeof change!=='object'||Object.keys(change).some(key=>key!=='path'&&key!=='value')||typeof change.path!=='string') throw new Error('Changes require only path and value');
  const {path,value}=change;
  if (path.split('.').some(part=>!part||unsafe.has(part))) throw new Error('Unsafe or unsupported authoring path');
  const parts=path.split('.');
  if (parts[0]==='tokens'&&tokenRoots.has(parts[1])&&parts.at(-1)==='$value') {
    const file=tokenFile(files,parts[1]);
    const local=parts.slice(1).join('.');
    if (getPath(files[file],local)===undefined) throw new Error(`Authoring path must already exist: ${path}`);
    return {path,value,file,local};
  }
  if (path==='components.button.accessibility.minimumTarget') {
    if (typeof value!=='string'||!/^\d+(?:\.\d+)?px$/.test(value)||Number.parseFloat(value)<40) throw new Error('Invalid supported button minimum target');
    return {path,value,file:'components/button.json',local:'accessibility.minimumTarget'};
  }
  throw new Error(`Unsupported authoring path: ${path}`);
}

function applyKnownChange(files, change) {
  const target=files[change.file]; const parts=change.local.split('.'); let current=target;
  for (const part of parts.slice(0,-1)) current=current[part];
  const leaf=parts.at(-1); const before=deepClone(current[leaf]); current[leaf]=deepClone(change.value);
  return {path:change.path,before,after:deepClone(change.value)};
}

function validateExceptions(exceptions) {
  if (exceptions===undefined) return [];
  if (!Array.isArray(exceptions)||exceptions.length>50) throw new Error('Exceptions must be a bounded list');
  return exceptions.map(entry=>{
    if (!entry||typeof entry!=='object'||Object.keys(entry).some(key=>!['rule','target','reason'].includes(key))||typeof entry.rule!=='string'||!entry.rule.trim()||typeof entry.target!=='string'||!entry.target.trim()||typeof entry.reason!=='string'||!entry.reason.trim()||entry.rule.length>100||entry.target.length>500||entry.reason.length>1000) throw new Error('Each exception needs rule, target, and reason');
    return {rule:entry.rule,target:entry.target,reason:entry.reason};
  });
}

function candidatePayload(candidate) {
  return {schemaVersion:candidate.schemaVersion,baseSha256:candidate.baseSha256,changes:candidate.changes,exceptions:candidate.exceptions,beforeAfterDiff:candidate.beforeAfterDiff,files:candidate.files,reviewRecord:candidate.reviewRecord};
}

function assertCandidate(candidate) {
  if (!candidate||typeof candidate!=='object'||Object.keys(candidate).some(key=>!['schemaVersion','baseSha256','candidateSha256','changes','exceptions','beforeAfterDiff','files','reviewRecord'].includes(key))) throw new Error('Invalid candidate');
  assertSafe(candidate);
  if (candidate.schemaVersion!==1||typeof candidate.baseSha256!=='string'||!/^[a-f0-9]{64}$/.test(candidate.baseSha256)||typeof candidate.candidateSha256!=='string'||!/^[a-f0-9]{64}$/.test(candidate.candidateSha256)||!Array.isArray(candidate.changes)||!Array.isArray(candidate.beforeAfterDiff)||!candidate.files||typeof candidate.files!=='object') throw new Error('Invalid candidate');
  if (digest(canonicalize(candidatePayload(candidate)))!==candidate.candidateSha256) throw new Error('Tampered candidate hash');
  validateExceptions(candidate.exceptions);
  validateConstitution({schemaVersion:1,files:candidate.files});
}

/** Parses only custom-property declarations in supplied local CSS text. Output is review input, never canonical mutation. */
export function importCssSuggestions(cssText) {
  if (typeof cssText!=='string'||Buffer.byteLength(cssText)>1_000_000) throw new Error('CSS text must be a bounded string');
  const suggestions=[],unmapped=[];
  const declaration=/--([A-Za-z][A-Za-z0-9-]{0,127})\s*:\s*([^;{}]{1,500})\s*;/g;
  for (const match of cssText.matchAll(declaration)) {
    const variable=`--${match[1]}`,value=match[2].trim(); let path;
    if (/^--color-([a-z]+)-(\d+)$/.test(variable)) { const [,family,step]=/^--color-([a-z]+)-(\d+)$/.exec(variable); path=`tokens.color.${family}.${step}.$value`; }
    else if (/^--space-(\d+)$/.test(variable)) { const [,step]=/^--space-(\d+)$/.exec(variable); path=`tokens.space.${step}.$value`; }
    else if (/^--font-size-(\d+)$/.test(variable)) { const [,step]=/^--font-size-(\d+)$/.exec(variable); path=`tokens.typography.fontSize.${step}.$value`; }
    else if (/^--semantic-([a-z0-9-]+)$/.test(variable)) { const [,parts]=/^--semantic-([a-z0-9-]+)$/.exec(variable); path=`tokens.semantic.${parts.replaceAll('-','.')}.$value`; }
    const unsafeValue=/url\s*\(|@import|expression\s*\(/i.test(value);
    const colorValue=/^#[0-9a-f]{6}$/i.test(value);
    const dimensionValue=/^-?(?:\d+|\d*\.\d+)(?:px|rem|em|%)$/.test(value);
    const expectedValue=path?.startsWith('tokens.color.')?colorValue:path?.startsWith('tokens.space.')||path?.startsWith('tokens.typography.fontSize.')?dimensionValue:colorValue||dimensionValue;
    if (!path||unsafeValue||!expectedValue) unmapped.push({variable,value,reason:unsafeValue||!expectedValue?'Unsupported value for the mapped token type':'No supported canonical mapping',provenance:{kind:'local-css-variable',offset:match.index}});
    else suggestions.push({path,value,accepted:false,provenance:{kind:'local-css-variable',variable,offset:match.index}});
  }
  return {suggestions,unmapped};
}

/** Returns the current, read-only set of authorable paths for a guided review UI. */
export async function getConstitutionAuthoringCatalog(sourceRoot) {
  const source=await readBundle(sourceRoot); const tokenPaths=[];
  function visit(value,path) {
    if (!value||typeof value!=='object'||Array.isArray(value)) return;
    if (Object.hasOwn(value,'$value')) {
      tokenPaths.push({path:`tokens.${path}.$value`,value:deepClone(value.$value),type:value.$type});
      return;
    }
    for (const [key,child] of Object.entries(value).sort(([a],[b])=>a.localeCompare(b))) visit(child,path?`${path}.${key}`:key);
  }
  for (const root of [...tokenRoots].sort()) {
    const file=tokenFile(source.bundle.files,root);
    visit(source.bundle.files[file][root],root);
  }
  const button=source.bundle.files['components/button.json'];
  return {baseSha256:source.sha256,tokenPaths,buttonMinimumTarget:{path:'components.button.accessibility.minimumTarget',value:deepClone(button.accessibility.minimumTarget)}};
}

export async function createConstitutionCandidate(sourceRoot,{changes,exceptions}={}) {
  const source=await readBundle(sourceRoot);
  if (!Array.isArray(changes)||changes.length<1||changes.length>50) throw new Error('Changes must be a bounded nonempty list');
  const normalized=changes.map(change=>allowableChange(change,source.bundle.files));
  if (new Set(normalized.map(change=>change.path)).size!==normalized.length) throw new Error('Duplicate authoring paths are unsupported');
  const files=deepClone(source.bundle.files); const beforeAfterDiff=normalized.map(change=>applyKnownChange(files,change));
  validateConstitution({schemaVersion:1,files});
  const safeExceptions=validateExceptions(exceptions);
  const candidate={schemaVersion:1,baseSha256:source.sha256,changes:normalized.map(({path,value})=>({path,value:deepClone(value)})),exceptions:safeExceptions,beforeAfterDiff,files,reviewRecord:{status:'pending-human-review',exceptionsRequireReview:safeExceptions.length>0}};
  return {...candidate,candidateSha256:digest(canonicalize(candidatePayload(candidate)))};
}

/** Writes a new canonical repository only after the caller repeats the exact candidate hash. */
export async function exportConstitutionCandidate(sourceRoot,candidate,expectedHash,newDestination) {
  assertCandidate(candidate);
  if (typeof expectedHash!=='string'||expectedHash!==candidate.candidateSha256) throw new Error('Expected candidate hash does not match');
  const source=await readBundle(sourceRoot);
  if (source.sha256!==candidate.baseSha256) throw new Error('Stale base constitution: create a new candidate');
  const normalized=candidate.changes.map(change=>allowableChange(change,source.bundle.files));
  if (!normalized.length||new Set(normalized.map(change=>change.path)).size!==normalized.length) throw new Error('Candidate changes cannot be reconstructed');
  const expectedChanges=normalized.map(({path,value})=>({path,value:deepClone(value)}));
  const reconstructedFiles=deepClone(source.bundle.files);
  const expectedDiff=normalized.map(change=>applyKnownChange(reconstructedFiles,change));
  const expectedExceptions=validateExceptions(candidate.exceptions);
  const expectedReview={status:'pending-human-review',exceptionsRequireReview:expectedExceptions.length>0};
  if (canonicalize(candidate.changes)!==canonicalize(expectedChanges)||canonicalize(candidate.beforeAfterDiff)!==canonicalize(expectedDiff)||canonicalize(candidate.files)!==canonicalize(reconstructedFiles)||canonicalize(candidate.reviewRecord)!==canonicalize(expectedReview)) throw new Error('Candidate cannot be reconstructed from the base and allowlisted changes');
  const parent=await realpath(dirname(resolve(newDestination)));
  const destination=resolve(parent,basename(resolve(newDestination)));
  if (inside(source.root,destination)||inside(source.spec,destination)) throw new Error('Export destination must be outside the source and canonical spec');
  try { await lstat(destination); throw new Error('Export destination already exists'); } catch (error) { if (error?.code!=='ENOENT') throw error; }
  await mkdir(destination,{mode:0o700});
  const spec=resolve(destination,'spec'); await mkdir(spec,{mode:0o700});
  for (const [name,value] of Object.entries(candidate.files).sort(([a],[b])=>a.localeCompare(b))) {
    const output=resolve(spec,name); if (!inside(spec,output)) throw new Error('Unsafe candidate file path');
    await mkdir(dirname(output),{recursive:true,mode:0o700});
    await writeFile(output,canonicalize(value)+'\n',{flag:'wx',mode:0o600});
  }
  await writeFile(resolve(destination,'constitution-review.json'),canonicalize({schemaVersion:1,baseSha256:candidate.baseSha256,candidateSha256:candidate.candidateSha256,reviewRecord:candidate.reviewRecord,exceptions:candidate.exceptions})+'\n',{flag:'wx',mode:0o600});
  return {baseSha256:candidate.baseSha256,candidateSha256:candidate.candidateSha256,destination,spec};
}
