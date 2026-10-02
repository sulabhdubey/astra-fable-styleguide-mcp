import {randomUUID,createHash} from 'node:crypto';
import {writeFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadRunningProject} from './running-app.mjs';

const fields=['url','sourceDirectory','buildDirectory','identityFiles','sourcePath','trigger','dialog','close','name','measurement','fontSize','paddingTop'];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Validate an offline draft through the same loader used by the real checker. */
export async function previewRunningSetup(directory,options) {
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!fields.includes(key))||fields.some(key=>typeof options[key]!=='string'))throw new Error('Complete the running-project setup fields');
  const values=Object.fromEntries(fields.map(key=>[key,options[key].trim()]));
  const {url,sourceDirectory,buildDirectory,sourcePath,trigger,dialog,close,name,measurement,fontSize,paddingTop}=values;
  if(new Set([trigger,dialog,close,measurement]).size!==4)throw new Error('Choose distinct open, dialog, close and measurement IDs');
  if(!fontSize&&!paddingTop)throw new Error('Choose at least one canonical font-size or padding token');
  const config={schemaVersion:2,integration:'vite-preview',url,sourceDirectory,buildDirectory,identityFiles:values.identityFiles.split(',').map(path=>path.trim()),
    journey:{buttons:[trigger],trigger,dialog,close,name,dialogButtons:[close]},
    targetPaths:{[trigger]:sourcePath,[close]:sourcePath,[measurement]:sourcePath,dialog:sourcePath,page:sourcePath},
    measurements:[{selector:measurement,target:measurement,...(fontSize?{typography:{fontSize}}:{}),...(paddingTop?{spacing:{paddingTop}}:{})}]};
  const temporary=resolve(directory,`.stylecon-setup-${randomUUID()}.json`);
  await writeFile(temporary,JSON.stringify(config),{flag:'wx',mode:0o600});
  try {
    const project=await loadRunningProject(temporary);
    if(!Object.hasOwn(project.identity.before.files,`build/${buildDirectory}/index.html`))throw new Error('Build index.html is missing. Build your trusted Vite project before reviewing setup.');
    for(const group of ['typography','spacing'])for(const value of Object.values(project.measurements[0].expected[group]))if(typeof value!=='string'||!/^\d+(?:\.\d+)?(?:px|rem|em)$/.test(value))throw new Error('Choose a dimension token in px, rem or em for this measurement');
    const preview={config,measurements:project.measurements,sourceSha256:project.identity.before.sha256,specSha256:project.contract.specSha256,browserTargetsVerified:false,
      scope:'One dialog journey at 1280px; selected design measurements at 1280px and 390px. Source paths are labels, not repair authorization.',
      next:'Save this configuration, start your trusted Vite production preview, then Run checks to verify the actual targets. Setup never starts project scripts or contacts the preview.'};
    return {...preview,previewSha256:hash(preview)};
  }finally{await unlink(temporary);}
}

export async function saveRunningSetup(directory,options,previewSha256) {
  const preview=await previewRunningSetup(directory,options);
  if(preview.previewSha256!==previewSha256)throw new Error('Setup inputs, project files or canonical rules changed; review setup again');
  await writeFile(resolve(directory,'project.json'),JSON.stringify(preview.config,null,2)+'\n',{flag:'wx',mode:0o600});
  return {created:'project.json',browserTargetsVerified:false,next:preview.next};
}
