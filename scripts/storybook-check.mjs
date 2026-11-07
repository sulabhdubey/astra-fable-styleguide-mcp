/* global window, document */
import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {snapshotRunningProject,bundledConstitution,expectedMeasurement,collectMeasurements,allowedRunningRequest} from './running-app.mjs';
import {loadPinnedConstitution} from './constitution.mjs';
import {cssTokens} from './running-app.mjs';
import {evaluateDesignObservations} from './design-observations.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const idPattern=/^[a-z][a-z0-9-]{0,99}$/;
const selectorPattern=/^#[A-Za-z][\w-]*$/;
const groups=['typography','spacing','contrast'];
export const supportedStoryVersions={react:'19.3.0',reactDom:'19.3.0',storybook:'10.6.3',vite:'8.3.3'};
export function validateStorySelection(config,selection) {
  const story=config.stories.find(item=>item.id===selection?.storyId);
  if(!story||!Array.isArray(selection.rules)||!selection.rules.length||selection.rules.length>3||new Set(selection.rules).size!==selection.rules.length||selection.rules.some(rule=>!groups.includes(rule)||!story.measurements.some(item=>item[rule])))throw new Error('Select a configured story and at least one available rule group');
  return {storyId:story.id,rules:groups.filter(group=>selection.rules.includes(group))};
}
export function storyCompletionCheck(id,state) {
  const complete=state?.id===id&&state.status==='completed';
  return {ruleId:'STORY-EXECUTION',check:'story.execution',target:id,status:complete?'pass':'not_checked',observed:state?.status??'missing',expected:'completed',fix:'Complete this configured story before evaluating its rendered state.',limitation:'Completion of the trusted portable-story harness is required; a skipped, failed or unfinished story is incomplete.'};
}
export async function loadStorybookProject(configPath) {
  const full=await realpath(configPath),root=await realpath(dirname(full)),raw=await readFile(full,'utf8');
  if(raw.length>32_000)throw new Error('Story configuration too large');
  const config=JSON.parse(raw),url=new URL(config.url);
  const fields=['schemaVersion','integration','url','sourceDirectory','buildDirectory','identityFiles','constitution','stories','versions'];
  if(Object.keys(config).some(key=>!fields.includes(key))||config.schemaVersion!==3||config.integration!=='storybook-portable'||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('Use the supported portable-story configuration and explicit loopback origin');
  if(!Array.isArray(config.identityFiles)||!config.identityFiles.length||config.identityFiles.length>10||new Set(config.identityFiles).size!==config.identityFiles.length||config.sourceDirectory===config.buildDirectory)throw new Error('Invalid story source identity');
  if(!config.versions||Object.keys(config.versions).sort().join(',')!=='react,reactDom,storybook,vite'||Object.values(config.versions).some(value=>typeof value!=='string'||!/^\d+\.\d+\.\d+$/.test(value)))throw new Error('Pin exact Storybook, React, ReactDOM and Vite versions');
  if(Object.entries(supportedStoryVersions).some(([key,value])=>config.versions[key]!==value))throw new Error('Unsupported portable-story version combination');
  for(const key of ['sourceDirectory','buildDirectory'])if(typeof config[key]!=='string'||!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(config[key]))throw new Error('Invalid story directory');
  const source=config.sourceDirectory.toLowerCase(),build=config.buildDirectory.toLowerCase();
  if(source===build||source.startsWith(build+'/')||build.startsWith(source+'/'))throw new Error('Source and build directories must not overlap');
  if(config.identityFiles.some(path=>typeof path!=='string'||[source,build].some(dir=>path.toLowerCase()===dir||path.toLowerCase().startsWith(dir+'/'))))throw new Error('Identity files must be outside source and build');
  if(!Array.isArray(config.stories)||!config.stories.length||config.stories.length>30||new Set(config.stories.map(s=>s.id)).size!==config.stories.length)throw new Error('Invalid story coverage');
  const project={root,configPath:full,config,configHash:digest(raw)};
  project.identity={before:await snapshotRunningProject(project)};
  let constitution=await bundledConstitution();
  if(config.constitution){const pinned=await loadPinnedConstitution(root,config.constitution);const bundle=JSON.parse(await readFile(resolve(root,config.constitution.path),'utf8'));constitution={contract:pinned.contract,tokens:cssTokens(pinned.css),rules:bundle.files['accessibility/rules.json']};}
  project.contract=constitution.contract;project.stories=[];
  for(const story of config.stories) {
    if(!story||Object.keys(story).some(key=>!['id','name','source','measurements'].includes(key))||!idPattern.test(story.id)||typeof story.name!=='string'||!story.name.trim()||story.name.length>100||!Object.hasOwn(project.identity.before.files,`source/${story.source}`))throw new Error('Invalid story or source label');
    if(!Array.isArray(story.measurements)||!story.measurements.length||story.measurements.length>20)throw new Error('Configure one to twenty story measurements');
    const seen=new Set();
    const measurements=story.measurements.map(item=>{
      if(!item||Object.keys(item).some(key=>!['selector','target',...groups].includes(key))||!selectorPattern.test(item.selector)||item.target!==item.selector||seen.has(item.target))throw new Error('Use unique plain ID measurement selectors');
      seen.add(item.target);
      for(const group of groups)if(item[group]!==undefined){const allowed=group==='typography'?['fontSize','fontFamily','lineHeight']:group==='spacing'?['paddingTop']:['foreground','background'];if(!item[group]||Array.isArray(item[group])||typeof item[group]!=='object'||!Object.keys(item[group]).length||Object.keys(item[group]).some(key=>!allowed.includes(key)))throw new Error('Invalid story measurement group');}
      if(!groups.some(group=>item[group]))throw new Error('Empty story measurement');
      return {...item,expected:expectedMeasurement(item,constitution.tokens,constitution.rules)};
    });
    project.stories.push({...story,measurements});
  }
  return project;
}
export async function runStorybookCheck(configPath,{launch,selection}={}) {
  const project=await loadStorybookProject(configPath);
  const selected=validateStorySelection(project.config,selection??{storyId:project.stories[0].id,rules:groups.filter(group=>project.stories[0].measurements.some(item=>item[group]))});
  const story=project.stories.find(item=>item.id===selected.storyId);
  const measurements=story.measurements.filter(item=>selected.rules.some(group=>item[group])).map(item=>({...item,expected:Object.fromEntries(selected.rules.filter(group=>item.expected[group]).map(group=>[group,item.expected[group]]))}));
  const start=launch??(async()=>{const {chromium}=await import('playwright');return chromium.launch({headless:true});});
  const browser=await start(),checks=[],previews=[],states=[];let runtimeErrors=0;
  const origin=new URL(project.config.url).origin;
  try {
    const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});context.setDefaultTimeout(5000);context.setDefaultNavigationTimeout(10000);
    const paths=new Set(Object.keys(project.identity.before.files).filter(key=>key.startsWith(`build/${project.config.buildDirectory}/`)).map(key=>'/'+key.slice(`build/${project.config.buildDirectory}/`.length))),responses=[];
    await context.route('**/*',route=>allowedRunningRequest(origin,route.request().url(),route.request().method(),paths)?route.continue():(runtimeErrors++,route.abort()));
    await context.routeWebSocket('**/*',socket=>{runtimeErrors++;socket.close();});
    context.on('page',page=>{page.on('pageerror',()=>runtimeErrors++);page.on('console',message=>{if(message.type()==='error')runtimeErrors++;});page.on('download',()=>runtimeErrors++);page.on('response',response=>{
      if(response.status()!==200||response.request().redirectedFrom())runtimeErrors++;
      const path=new URL(response.url()).pathname.replace(/^\//,'')||'index.html',key=`build/${project.config.buildDirectory}/${path}`;
      responses.push(response.body().then(bytes=>{if(digest(bytes)!==project.identity.before.files[key])runtimeErrors++;}).catch(()=>runtimeErrors++));
    });});
    for(const width of [1280,390]) {
      const page=await context.newPage();await page.setViewportSize({width,height:900});let state;
      try {
        await page.goto(`${origin}/#${story.id}`);
        await page.waitForFunction(()=>window.__STYLECON_STORY__&&['completed','skipped','error'].includes(window.__STYLECON_STORY__.status),null,{timeout:5000});
        state=await page.evaluate(()=>{const value=JSON.stringify(window.__STYLECON_STORY__);if(value.length>32_000)throw new Error('Story state too large');return JSON.parse(value);});
        if(state.schemaVersion!==1||Object.entries(project.config.versions).some(([key,value])=>state.versions?.[key]!==value))state={id:story.id,status:'version-mismatch'};
      }catch{state={id:story.id,status:'unfinished'};}
      const execution=storyCompletionCheck(story.id,state);execution.viewport={width,height:900};checks.push(execution);
      states.push({width,args:state.args??null,globals:state.globals??null});
      if(execution.status==='pass') {
        const measured=await collectMeasurements(page,measurements);const findings=evaluateDesignObservations(measured);checks.push(...findings);
        const selectors=[...new Set(findings.filter(check=>check.status==='fail').map(check=>check.selector))];
        await page.evaluate(items=>{for(const selector of items){const element=document.querySelector(selector);if(element)element.style.outline='3px solid #c02646';}},selectors);
        const bounds=await page.locator('body').boundingBox();
        const height=Math.min(900,Math.max(160,Math.ceil((bounds?.y??0)+(bounds?.height??900)+24)));
        const bytes=await page.screenshot({type:'png',clip:{x:0,y:0,width,height}});if(bytes.length<=500_000)previews.push({width,png:bytes.toString('base64')});
      }
      await page.close();
    }
    await Promise.all(responses);
    const after=await snapshotRunningProject(project);if(after.sha256!==project.identity.before.sha256)throw new Error('Story source or build changed during verification; rerun');
    if(runtimeErrors)checks.push({ruleId:'STORY-RESOURCES',check:'story.resources',target:story.id,status:'not_checked',observed:runtimeErrors,expected:0,fix:'Use a self-contained matching build without blocked resources or runtime errors.'});
    const status=checks.some(check=>check.status==='fail')?'fail':checks.every(check=>check.status==='pass')?'pass':'not_checked';
    const configHash=digest(JSON.stringify([project.configHash,selected]));
    const report={schemaVersion:1,status,artifactSha256:project.identity.before.sha256,specSha256:project.contract.specSha256,specHashScope:project.contract.specHashScope,constitution:project.contract.constitution,projectConfigurationSha256:configHash,checks,
      browserScope:{integration:'storybook-portable',selection:selected,configurationSha256:project.configHash,versions:project.config.versions,browserVersion:browser.version(),states},
      limitations:['Configured portable story and selected rules only. No complete accessibility or interaction audit.','Story completion comes from the trusted project harness; hashes do not authenticate the project or prove source-to-element mapping.','Source paths are labels only. No automatic Storybook source repairs are authorized.']};
    const targetPaths=Object.fromEntries([story.id,...measurements.map(item=>item.target)].map(target=>[target,story.source]));
    const summary={status,artifactSha256:report.artifactSha256,specSha256:report.specSha256,checks:checks.length,findings:checks.filter(check=>check.status!=='pass'),exitCode:checks.some(check=>['not_checked','unsupported'].includes(check.status))?2:status==='pass'?0:1};
    return {result:{report,repair:null,previews},summary,targetPaths};
  }finally{await browser.close();}
}
