import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAIInvoker,createAnthropicInvoker,OpenAIAdapter,AnthropicAdapter} from '../dist/packages/provider-adapters/src/index.js';

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
