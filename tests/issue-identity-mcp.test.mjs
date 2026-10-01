import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {StyleConstitutionClient} from '../packages/sdk/dist/index.js';
import {ClarificationStore} from '../dist/apps/mcp-server/src/clarification-store.js';

test('MCP carries caller IDs through real HTTP orchestration with a local deterministic provider', {timeout:25000},async()=>{
 const provider=createServer(async(req,res)=>{
  try{
   let body='';for await(const part of req)body+=part;
   const packet=JSON.parse(body);let answer;
   if(packet.format.properties.reviews){
    assert.deepEqual(packet.format.properties.issueReviews.required,['issue:target']);
    answer={reviews:{'tokens.radius.md.$value':{verdict:'accept',reason:'Requested value'}},issueReviews:{'issue:target':{verdict:'deferred',checkId:'measure',reason:'Browser observation remains pending'}}};
   }else{
    assert.ok(packet.format.properties.issueNotes);
    answer={summary:'Fixture',changes:[{path:'tokens.radius.md.$value',value:'11px'}],tradeoffs:[],unresolved:[],issueNotes:[{issueId:'target',note:'Additional explanation'},{issueId:'target',note:'Additional explanation'}]};
   }
   res.setHeader('content-type','application/json');res.end(JSON.stringify({response:JSON.stringify(answer),done:true}));
  }catch(error){res.statusCode=500;res.end(String(error));}
 });
 await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
 const portServer=createServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
 const dir=await mkdtemp(join(tmpdir(),'style-identity-mcp-')),journal=join(dir,'clarification.jsonl'),token=randomUUID();
 ClarificationStore.initialize(journal);
 const child=spawn(process.execPath,['--import','tsx','apps/mcp-server/src/official-server.ts'],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,HOST:'127.0.0.1',PORT:String(port),MCP_ENABLE_WRITES:'true',MCP_ENABLE_RELEASE_TOOL:'false',MCP_ENABLE_AI_ORCHESTRATION:'true',MCP_ADMIN_TOKEN:token,MCP_CLARIFICATION_PATH:journal,MCP_AUDIT_PATH:'',MCP_ASTRA_APPROVAL_TOKEN:'',MCP_FABLE_APPROVAL_TOKEN:'',ASTRA_PROVIDER:'ollama',FABLE_PROVIDER:'ollama',ASTRA_MODEL:'fixture',FABLE_MODEL:'fixture',OLLAMA_GENERATE_URL:`http://127.0.0.1:${provider.address().port}/api/generate`}});
 let errors='';child.stderr.on('data',b=>errors+=b);
 const client=new StyleConstitutionClient({endpoint:`http://127.0.0.1:${port}/mcp`,fetchImpl:(url,init={})=>{const headers=new Headers(init.headers);headers.set('authorization','Bearer '+token);return fetch(url,{...init,headers});}});
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await client.health()).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,errors);await client.connect();
  const {tools}=await client.listTools();const tool=tools.find(t=>t.name==='generate_style_constitution_candidate');assert.ok(tool.inputSchema.properties.reviewScope.properties.issues);
  const response=await client.connection.callTool({name:tool.name,arguments:{brief:'Change only the medium radius token to 11px.',maxRounds:1,reviewScope:{stage:'specification',pendingChecks:[{id:'measure',requirement:'Usable targets',evidenceRequired:'Browser measurements'}],issues:[{id:'target',text:'Rendered dimensions remain unmeasured.'}]}}});
  assert.equal(response.isError,undefined,JSON.stringify(response));
  const result=JSON.parse(response.content.find(c=>c.type==='text').text);
  assert.equal(result.status,'CONSENSUS');assert.equal(result.issueNotes.length,1);
  assert.ok(result.initial.every(p=>p.unresolved.length===1));
  assert.ok(result.reviewReadiness.deferredIssues.every(d=>d.issueId==='target'&&d.status==='open'&&d.evidenceKind==='unverified'));
  assert.equal(result.reviewReadiness.renderedVerified,false);
 }finally{
  await client.close();child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});
  await new Promise(resolve=>provider.close(resolve));await rm(dir,{recursive:true,force:true});
 }
});
