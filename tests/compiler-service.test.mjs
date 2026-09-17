import test from 'node:test';import assert from 'node:assert/strict';import {loadBundle,loadJson} from './helpers.mjs';import {readFile} from 'node:fs/promises';
import {compileCss,compileFlat} from '../dist/packages/token-compiler/src/index.js';import {StyleService} from '../dist/apps/mcp-server/src/service.js';
test('token compiler resolves semantic tokens',async()=>{const b=await loadBundle();const flat=compileFlat(b.tokens);assert.equal(flat['semantic.action.primary.background'],'#1D4ED8');assert.match(compileCss(b.tokens),/--semantic-action-primary-background: #1D4ED8/);});
test('service validates and returns component rules',async()=>{const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{'ADR.md':'hello'}});assert.equal(service.validate().valid,true);assert.equal(service.getComponentRules('button').id,'button');assert.equal(service.explainDecision('ADR.md').text,'hello');});
test('compliance checker flags arbitrary values',async()=>{const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});const r=service.checkStyleCompliance('.x{color:#ABCDEF;margin:27px}');assert.equal(r.compliant,false);assert.ok(r.violations.length>=2);});
test('mutation service rejects unauthenticated proposal writes',async()=>{const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});const proposal={id:'P1',author:'astra',baseVersion:'0.1.0',summary:'x',changes:[{path:'x',value:1}],tradeoffs:[],unresolved:[]};assert.throws(()=>service.createProposal('P1',proposal,undefined,'secret'),/Unauthorized/);assert.equal(service.createProposal('P1',proposal,'secret','secret').status,'open');});


test('governed proposal lifecycle requires exact roles, dual approval, and human gate',async()=>{const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});const mk=(id,author)=>({id,author,baseVersion:'0.1.0',summary:'same',changes:[{path:'tokens.radius.md.$value',value:'8px'}],tradeoffs:[],unresolved:[]});service.createProposal('A',mk('A','astra'),'secret','secret');service.createProposal('F',mk('F','fable'),'secret','secret');assert.equal(service.evaluateProposal('A','secret','secret').valid,true);const round=await service.startConsensusRound('A','F','secret','secret');assert.equal(round.status,'candidate_ready');const h=round.candidateHash;assert.throws(()=>service.publishRelease(h,true,'secret','secret','human','human'),/Astra and Fable approvals/);service.approveCandidate(h,'astra','secret','secret');service.approveCandidate(h,'fable','secret','secret');assert.throws(()=>service.publishRelease(h,false,'secret','secret','human','human'),/Human approval/);assert.equal(service.publishRelease(h,true,'secret','secret','human','human').status,'released');});


test('conflicting stored proposals do not create a candidate',async()=>{const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});const mk=(id,author,value)=>({id,author,baseVersion:'0.1.0',summary:'x',changes:[{path:'same.path',value}],tradeoffs:[],unresolved:[]});service.createProposal('A2',mk('A2','astra',1),'s','s');service.createProposal('F2',mk('F2','fable',2),'s','s');const r=await service.startConsensusRound('A2','F2','s','s');assert.equal(r.status,'needs_revision');assert.ok(r.conflicts.length===1);});

test('publish is protected by admin authorization',async()=>{const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});assert.throws(()=>service.publishRelease('nope',true,undefined,'secret','human','human'),/Unauthorized/);});

test('one-call agent orchestration independently proposes, cross-reviews, validates, and creates a governed candidate',async()=>{
  const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});
  const {MockAgent}=await import('../dist/packages/provider-adapters/src/index.js');
  const mk=(id,author,value)=>({id,author,baseVersion:'0.1.0',summary:'product-specific radius',changes:[{path:'tokens.radius.md.$value',value,rationale:'Mock design direction'}],tradeoffs:[],unresolved:[]});
  const astra=new MockAgent('astra',{initial:mk('AUTO-A','astra','4px'),convergeTo:{'tokens.radius.md.$value':'8px'}});
  const fable=new MockAgent('fable',{initial:mk('AUTO-F','fable','12px'),convergeTo:{'tokens.radius.md.$value':'8px'}});
  const run=await service.generateCandidateFromBrief({brief:'Premium analytics product',criteria:['accessibility','consistency'],astra,fable},'secret','secret');
  assert.equal(run.status,'CONSENSUS');assert.equal(run.initial.length,2);assert.equal(run.critiques.length,2);assert.equal(service.getConsensusStatus(run.candidateHash).source,'agent-consensus');
  assert.equal(astra.seenInitialContexts.length,1);assert.equal(fable.seenInitialContexts.length,1);assert.equal('proposal' in astra.seenInitialContexts[0],false);
});

test('deterministic candidate evaluation rejects unsupported or non-leaf changes',async()=>{
  const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});
  const bad={id:'BAD',author:'astra',baseVersion:'0.1.0',summary:'invalid',changes:[{path:'manifest.version',value:'9.9.9'}],tradeoffs:[],unresolved:[]};
  service.createProposal('BAD',bad,'secret','secret');const result=service.evaluateProposal('BAD','secret','secret');assert.equal(result.valid,false);assert.match(result.deterministicErrors[0],/Unsupported change path/);
});

test('release requires a credential distinct from ordinary admin authorization',async()=>{
  const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});const mk=(id,author)=>({id,author,baseVersion:'0.1.0',summary:'same',changes:[{path:'tokens.radius.md.$value',value:'8px'}],tradeoffs:[],unresolved:[]});
  service.createProposal('RA',mk('RA','astra'),'admin','admin');service.createProposal('RF',mk('RF','fable'),'admin','admin');const c=await service.startConsensusRound('RA','RF','admin','admin');service.approveCandidate(c.candidateHash,'astra','admin','admin');service.approveCandidate(c.candidateHash,'fable','admin','admin');assert.throws(()=>service.publishRelease(c.candidateHash,true,'admin','admin',undefined,'human-secret'),/Separate human approval credential/);assert.equal(service.publishRelease(c.candidateHash,true,'admin','admin','human-secret','human-secret').status,'released');
});
