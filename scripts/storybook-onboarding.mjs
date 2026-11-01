import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,dirname,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {loadStorybookProject,supportedStoryVersions} from './storybook-check.mjs';
import {copyStarterFiles} from '../packages/cli/storybook/assets.mjs';

const assets=fileURLToPath(new URL('../packages/cli/storybook/starter/',import.meta.url));
const pins={react:supportedStoryVersions.react,'react-dom':supportedStoryVersions.reactDom,storybook:supportedStoryVersions.storybook,'@storybook/react':supportedStoryVersions.storybook,vite:supportedStoryVersions.vite};
export async function prepareStorybookDemo(destination){
  if(!isAbsolute(destination))throw new Error('Use a new absolute destination directory');
  // Exclusive creation: never merge a starter into an existing owner project.
  await mkdir(destination);
  await copyStarterFiles(assets,destination,{projectOnly:true});
  for(const file of ['README.md','PILOT_FEEDBACK.md'])await writeFile(join(destination,file),await readFile(join(assets,file)),{flag:'wx'});
  for(const directory of [destination,join(destination,'project')])await writeFile(join(directory,'.gitignore'),await readFile(join(assets,'gitignore.txt')),{flag:'wx'});
  await mkdir(join(destination,'evidence'));
  return {project:join(destination,'project'),config:join(destination,'project/project.json'),evidence:join(destination,'evidence'),instructions:join(destination,'README.md'),feedback:join(destination,'PILOT_FEEDBACK.md'),next:'Read README.md, install the pinned starter dependencies, build, then start its loopback preview. Nothing is installed or executed automatically.'};
}

async function boundedJson(path,max=32_000){if((await stat(path)).size>max)throw new Error('File too large');return JSON.parse(await readFile(path,'utf8'));}
async function previewMatches(url,expected){
  const response=await fetch(url,{redirect:'error',signal:globalThis.AbortSignal.timeout(3000)});
  if(response.status!==200||!response.body){await response.body?.cancel();return false;}
  const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000)return false;parts.push(value);}return Buffer.concat(parts).equals(expected);}
  finally{await reader.cancel();}
}
export async function doctor(input,{launch}={}){
  const checks=[],add=(id,ok,next)=>checks.push({id,status:ok?'pass':'fail',next:ok?null:next});
  const [major,minor]=process.versions.node.split('.').map(Number);
  add('node',major>22||(major===22&&minor>=12),'Use Node.js 22.12 or newer.');
  let browserInstalled=false;
  try{const start=launch??(async()=>{const {chromium}=await import('playwright');return chromium.launch({headless:true,timeout:10000});});const browser=await start();await browser.close();browserInstalled=true;}catch{/* Do not expose browser logs, environment or private paths. */}
  add('browser',browserInstalled,'Run stylecon browser-install, then retry. If installed, check local browser launch permissions and required operating-system libraries.');
  if(input){
    const path=resolve(input);let configPath=path,config,root,project;
    try{if((await stat(path)).isDirectory())configPath=join(path,'project.json');root=dirname(configPath);config=await boundedJson(configPath);if(!config||typeof config!=='object')throw new Error();}catch{add('configuration',false,'Choose a readable Storybook project.json (schema 3).');}
    if(config){
      let dependencies=false;
      try{const require=createRequire(join(root,'package.json'));dependencies=(await Promise.all(Object.entries(pins).map(async([name,version])=>(await boundedJson(require.resolve(`${name}/package.json`),200_000)).version===version))).every(Boolean);}catch{/* Missing or invalid installed dependencies. */}
      add('dependencies',dependencies,'In the generated starter project, run npm ci --ignore-scripts. Other projects must use the documented exact supported versions.');
      let built=false;
      try{if(typeof config.buildDirectory!=='string'||! /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(config.buildDirectory))throw new Error();built=(await stat(join(root,config.buildDirectory,'index.html'))).isFile();}catch{/* Missing or invalid build directory. */}
      add('build',built,'Review the project build script, then run npm run build in the starter project.');
      try{project=await loadStorybookProject(configPath);add('configuration',true);}catch{add('configuration',false,'Check the supported version pins, source files, build and identity files in project.json. No preview request was made.');}
      if(project){
        let matching=false;try{matching=await previewMatches(project.config.url,await readFile(join(project.root,project.config.buildDirectory,'index.html')));}catch{/* Fixed diagnostic; do not reflect server responses. */}
        add('preview',matching,'Run npm run preview in a second terminal. Use the configured loopback port and rebuild/restart if the served index differs. Redirects are rejected.');
      }
    }
  }
  const ready=checks.every(check=>check.status==='pass');
  return {schemaVersion:1,scope:'readiness only; no story compliance result',browserInstalled,node:process.version,ready,exitCode:ready?0:2,checks,next:ready?(input?'Run stylecon check on the selected story; readiness does not certify its rules.':'Pass a Storybook project path to check its readiness.'):'Resolve the failed readiness checks and retry.'};
}
