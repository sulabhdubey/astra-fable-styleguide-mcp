import {loadProject,startProjectServer} from './project-workflow.mjs';
import {verifyProject} from './verify-project.mjs';
import {inspectReport} from './project-cli.mjs';

export function allowedRequest(origin,url,method) {
  try {const target=new URL(url);return method==='GET'&&target.origin===origin&&!target.username&&!target.password&&target.pathname!=='/_verification';}
  catch{return false;}
}

// Adapt the existing observed journey; no alternate evaluator or injected page state.
function connectedTab(page) {
  const snapshot=()=>page.locator('body').ariaSnapshot();
  return {
    url:()=>page.url(),goto:url=>page.goto(url),reload:()=>page.reload(),
    pressKey:(_target,key)=>page.keyboard.press(key.replace('shift+','Shift+')),
    getAXState:snapshot,
    playwright:{locator:s=>page.locator(s),getByRole:(role,options)=>page.getByRole(role,options),
      evaluate:(fn,arg)=>page.evaluate(fn,arg),domSnapshot:snapshot,
      waitForLoadState:({state})=>page.waitForLoadState(state)}
  };
}

export async function runCheck(configPath,{launch}={}) {
  const project=await loadProject(configPath);
  const start=launch??(async()=>{const {chromium}=await import('playwright');return chromium.launch({headless:true});});
  const browser=await start();let server;
  try {
    server=await startProjectServer(project);
    const origin=`http://127.0.0.1:${server.address().port}`;
    const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',acceptDownloads:false});
    context.setDefaultTimeout(5000);context.setDefaultNavigationTimeout(10000);
    let runtimeErrors=0;
    await context.route('**/*',route=>{
      if(allowedRequest(origin,route.request().url(),route.request().method()))return route.continue();
      runtimeErrors++;return route.abort();
    });
    await context.routeWebSocket('**/*',socket=>{runtimeErrors++;socket.close();});
    context.on('page',p=>{
      p.on('pageerror',()=>runtimeErrors++);
      p.on('console',message=>{if(message.type()==='error')runtimeErrors++;});
      p.on('response',response=>{if(response.status()>=400)runtimeErrors++;});
    });
    const page=await context.newPage();
    const result=await verifyProject(connectedTab(page),origin+'/');
    if(runtimeErrors)throw new Error('Incomplete verification: page errors or blocked/failed resources; use a self-contained supported project');
    const summary=await inspectReport(project,result);
    return {result,summary,targetPaths:project.config.targetPaths};
  } finally {
    try {await browser.close();}
    finally {if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
  }
}

export function formatReport(result,targetPaths,format='text') {
  const report=result.report??result;
  if(format==='json')return JSON.stringify(result,null,2);
  if(format==='text')return [report.status,...report.checks.filter(c=>c.status!=='pass').map(c=>`${c.ruleId} ${targetPaths[c.target]??'(unmapped)'} ${c.target}: ${c.status} — ${c.fix}`)].join('\n');
  if(format!=='sarif')throw new Error('Format must be text, json or sarif');
  return JSON.stringify({version:'2.1.0',$schema:'https://json.schemastore.org/sarif-2.1.0.json',runs:[{
    tool:{driver:{name:'Style Constitution'}},
    properties:{status:report.status,artifactSha256:report.artifactSha256,specSha256:report.specSha256},
    results:report.checks.filter(c=>c.status!=='pass').map(c=>({ruleId:c.ruleId,level:c.status==='fail'?'error':'warning',
      message:{text:`${c.target}: ${c.status}. ${c.fix}`},
      ...(targetPaths[c.target]?{locations:[{physicalLocation:{artifactLocation:{uri:targetPaths[c.target]}}}]}:{})}))
  }]},null,2);
}
