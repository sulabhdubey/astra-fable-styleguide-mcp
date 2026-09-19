import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAIInvoker,createAnthropicInvoker,createOllamaInvoker,createConfiguredAgent,ConfigurableAgent,OpenAIAdapter,AnthropicAdapter,OllamaAdapter,MockAgent} from '../dist/packages/provider-adapters/src/index.js';
import {StyleService} from '../dist/apps/mcp-server/src/service.js';
import {loadBundle} from './helpers.mjs';

const proposalJson={summary:'Focused system',changes:[{path:'tokens.radius.md.$value',value:'8px',rationale:'Consistent radius'}],tradeoffs:[],unresolved:[]};

test('OpenAI Responses invoker sends configured model/key and parses JSON text output',async()=>{
  const prior=globalThis.fetch;let seen;
  globalThis.fetch=async(url,init)=>{seen={url,init};return new Response(JSON.stringify({output_text:JSON.stringify(proposalJson)}),{status:200,headers:{'content-type':'application/json'}});};
  try{const agent=new OpenAIAdapter('astra','model-a',createOpenAIInvoker({apiKey:'test-key',endpoint:'https://example.test/v1/responses'}));const out=await agent.generateProposal({brief:'A sufficiently detailed product brief',criteria:['accessibility'],baseVersion:'0.1.0'});assert.equal(out.author,'astra');assert.equal(out.changes[0].path,'tokens.radius.md.$value');assert.equal(seen.url,'https://example.test/v1/responses');assert.equal(seen.init.headers.authorization,'Bearer test-key');assert.equal(JSON.parse(seen.init.body).model,'model-a');}finally{globalThis.fetch=prior;}
});

test('Anthropic Messages invoker sends configured model/key and parses text blocks',async()=>{
  const prior=globalThis.fetch;let seen;
  globalThis.fetch=async(url,init)=>{seen={url,init};return new Response(JSON.stringify({content:[{type:'text',text:JSON.stringify(proposalJson)}]}),{status:200,headers:{'content-type':'application/json'}});};
  try{const agent=new AnthropicAdapter('fable','model-f',createAnthropicInvoker({apiKey:'test-key',endpoint:'https://example.test/v1/messages'}));const out=await agent.generateProposal({brief:'A sufficiently detailed product brief',criteria:['consistency'],baseVersion:'0.1.0'});assert.equal(out.author,'fable');assert.equal(out.changes.length,1);assert.equal(seen.url,'https://example.test/v1/messages');assert.equal(seen.init.headers['x-api-key'],'test-key');assert.equal(JSON.parse(seen.init.body).model,'model-f');}finally{globalThis.fetch=prior;}
});

test('local Ollama invoker uses JSON mode without a provider key',async()=>{
  let seen;
  const fetchImpl=async(url,init)=>{seen={url,init};return new Response(JSON.stringify({response:JSON.stringify(proposalJson)}),{status:200,headers:{'content-type':'application/json'}});};
  const agent=new OllamaAdapter('astra','local-model',createOllamaInvoker({fetchImpl,timeoutMs:5000,numPredict:300}));
  const result=await agent.generateProposal({brief:'A focused settings interface',criteria:['consistency'],baseVersion:'0.1.0'});
  assert.equal(result.author,'astra');
  assert.equal(String(seen.url),'http://127.0.0.1:11434/api/generate');
  assert.equal(seen.init.headers.authorization,undefined);
  assert.deepEqual(JSON.parse(seen.init.body).format,'json');
  assert.equal(JSON.parse(seen.init.body).stream,false);
  assert.equal(JSON.parse(seen.init.body).model,'local-model');
  assert.throws(()=>createOllamaInvoker({endpoint:'https://paid.example/api/generate'}),/must be local/);
  assert.ok(createConfiguredAgent('fable',{FABLE_PROVIDER:'ollama',FABLE_MODEL:'another-local-model'}) instanceof OllamaAdapter);
});

test('provider failure leaves governed proposal state untouched',async()=>{
  const bundle=await loadBundle();
  const service=new StyleService({...bundle,principles:{},patterns:[],antiPatterns:{},decisions:{}});
  const astra=new OllamaAdapter('astra','unavailable',async()=>{throw new Error('local provider unavailable');});
  const fable=new MockAgent('fable',{initial:{id:'F-UNSAVED',author:'fable',baseVersion:'0.1.0',summary:'safe',changes:[{path:'tokens.radius.md.$value',value:'8px'}],tradeoffs:[],unresolved:[]}});
  await assert.rejects(service.generateCandidateFromBrief({brief:'A bounded design change for a settings page',criteria:['consistency'],maxRounds:1,astra,fable},'admin','admin'),/local provider unavailable/);
  assert.equal(service.getProposal('F-UNSAVED'),undefined);
});

test('provider critique rejects fabricated and contradictory paths',async()=>{
  const proposal={id:'P',author:'astra',baseVersion:'0.1.0',summary:'radius',changes:[{path:'tokens.radius.md.$value',value:'12px'}],tradeoffs:[],unresolved:[]};
  const context={brief:'Softer settings controls',criteria:['consistency'],baseVersion:'0.1.0',referenceSpec:{tokens:{radius:{md:{$value:'8px'}}}}};
  const agent=new ConfigurableAgent('fable',{provider:'mock',model:'mock'},async()=>({objections:[{path:'components.button.tokens.background.$value',reason:'Fabricated path',severity:'blocking'}],acceptedPaths:[]}));
  await assert.rejects(agent.critiqueProposal(proposal,context),/Unknown critique path/);
  const contradictory=new ConfigurableAgent('fable',{provider:'mock',model:'mock'},async()=>({objections:[{path:'tokens.radius.md.$value',reason:'Blocking concern',severity:'blocking'}],acceptedPaths:['tokens.radius.md.$value']}));
  await assert.rejects(contradictory.critiqueProposal(proposal,context),/Contradictory critique/);
});

test('provider proposal reports missing values without an internal cloning error',async()=>{
  const agent=new ConfigurableAgent('fable',{provider:'mock',model:'mock'},async()=>({summary:'Missing value',changes:[{path:'tokens.radius.md.$value'}]}));
  await assert.rejects(agent.generateProposal({brief:'A bounded settings design',criteria:['consistency'],baseVersion:'0.1.0'}),/invalid changes\[0\]\.value/);
});
