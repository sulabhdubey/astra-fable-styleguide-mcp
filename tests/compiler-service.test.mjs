import test from 'node:test';import assert from 'node:assert/strict';import {loadBundle,loadJson} from './helpers.mjs';import {readFile} from 'node:fs/promises';
import {compileCss,compileFlat} from '../dist/packages/token-compiler/src/index.js';import {StyleService} from '../dist/apps/mcp-server/src/service.js';
test('token compiler resolves semantic tokens',async()=>{const b=await loadBundle();const flat=compileFlat(b.tokens);assert.equal(flat['semantic.action.primary.background'],'#1D4ED8');assert.match(compileCss(b.tokens),/--semantic-action-primary-background: #1D4ED8/);});
test('service validates and returns component rules',async()=>{const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{'ADR.md':'hello'}});assert.equal(service.validate().valid,true);assert.equal(service.getComponentRules('button').id,'button');assert.equal(service.explainDecision('ADR.md').text,'hello');});
test('compliance checker flags arbitrary values',async()=>{const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});const r=service.checkStyleCompliance('.x{color:#ABCDEF;margin:27px}');assert.equal(r.compliant,false);assert.ok(r.violations.length>=2);});
test('mutation service rejects unauthenticated proposal writes',async()=>{const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});const proposal={id:'P1',author:'astra',baseVersion:'0.1.0',summary:'x',changes:[{path:'x',value:1}],tradeoffs:[],unresolved:[]};assert.throws(()=>service.createProposal('P1',proposal,undefined,'secret'),/Unauthorized/);assert.equal(service.createProposal('P1',proposal,'secret','secret').status,'open');});


test('governed proposal lifecycle requires exact roles, dual approval, and human gate',async()=>{const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});const mk=(id,author)=>({id,author,baseVersion:'0.1.0',summary:'same',changes:[{path:'tokens.radius.md.$value',value:'12px'}],tradeoffs:[],unresolved:[]});service.createProposal('A',mk('A','astra'),'secret','secret');service.createProposal('F',mk('F','fable'),'secret','secret');assert.equal(service.evaluateProposal('A','secret','secret').valid,true);const round=await service.startConsensusRound('A','F','secret','secret');assert.equal(round.status,'candidate_ready');const h=round.candidateHash;assert.throws(()=>service.publishRelease(h,true,'secret','secret','human','human'),/Astra and Fable approvals/);service.approveCandidate(h,'astra','secret','secret');service.approveCandidate(h,'fable','secret','secret');assert.throws(()=>service.publishRelease(h,false,'secret','secret','human','human'),/Human approval/);assert.equal(service.publishRelease(h,true,'secret','secret','human','human').status,'released');});


test('conflicting stored proposals do not create a candidate',async()=>{const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});const mk=(id,author,value)=>({id,author,baseVersion:'0.1.0',summary:'x',changes:[{path:'same.path',value}],tradeoffs:[],unresolved:[]});service.createProposal('A2',mk('A2','astra',1),'s','s');service.createProposal('F2',mk('F2','fable',2),'s','s');const r=await service.startConsensusRound('A2','F2','s','s');assert.equal(r.status,'needs_revision');assert.ok(r.conflicts.length===1);});

test('publish is protected by admin authorization',async()=>{const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});assert.throws(()=>service.publishRelease('nope',true,undefined,'secret','human','human'),/Unauthorized/);});

test('one-call agent orchestration independently proposes, cross-reviews, validates, and creates a governed candidate',async()=>{
  const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});
  const {MockAgent}=await import('../dist/packages/provider-adapters/src/index.js');
  const mk=(id,author,value)=>({id,author,baseVersion:'0.1.0',summary:'product-specific radius',changes:[{path:'tokens.radius.md.$value',value,rationale:'Mock design direction'}],tradeoffs:[],unresolved:[]});
  const astra=new MockAgent('astra',{initial:mk('AUTO-A','astra','4px'),convergeTo:{'tokens.radius.md.$value':'10px'}});
  const fable=new MockAgent('fable',{initial:mk('AUTO-F','fable','12px'),convergeTo:{'tokens.radius.md.$value':'10px'}});
  const run=await service.generateCandidateFromBrief({brief:'Premium analytics product',criteria:['accessibility','consistency'],astra,fable},'secret','secret');
  assert.equal(run.status,'CONSENSUS');assert.equal(run.initial.length,2);assert.equal(run.critiques.length,2);assert.equal(service.getConsensusStatus(run.candidateHash,'secret','secret').source,'agent-consensus');
  assert.equal(astra.seenInitialContexts.length,1);assert.equal(fable.seenInitialContexts.length,1);assert.equal('proposal' in astra.seenInitialContexts[0],false);
});

test('deterministic candidate evaluation rejects unsupported or non-leaf changes',async()=>{
  const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});
  const bad={id:'BAD',author:'astra',baseVersion:'0.1.0',summary:'invalid',changes:[{path:'manifest.version',value:'9.9.9'}],tradeoffs:[],unresolved:[]};
  service.createProposal('BAD',bad,'secret','secret');const result=service.evaluateProposal('BAD','secret','secret');assert.equal(result.valid,false);assert.match(result.deterministicErrors[0],/Unsupported change path/);
});

test('release requires a credential distinct from ordinary admin authorization',async()=>{
  const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});const mk=(id,author)=>({id,author,baseVersion:'0.1.0',summary:'same',changes:[{path:'tokens.radius.md.$value',value:'12px'}],tradeoffs:[],unresolved:[]});
  service.createProposal('RA',mk('RA','astra'),'admin','admin');service.createProposal('RF',mk('RF','fable'),'admin','admin');const c=await service.startConsensusRound('RA','RF','admin','admin');service.approveCandidate(c.candidateHash,'astra','admin','admin');service.approveCandidate(c.candidateHash,'fable','admin','admin');assert.throws(()=>service.publishRelease(c.candidateHash,true,'admin','admin',undefined,'human-secret'),/Separate human approval credential/);assert.throws(()=>service.publishRelease(c.candidateHash,true,'admin','admin','admin','admin'),/Separate human approval credential/);assert.equal(service.publishRelease(c.candidateHash,true,'admin','admin','human-secret','human-secret').status,'released');
});
test('candidate evaluation rejects an object inside a dimension token value',async()=>{
  const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});
  const proposal={id:'BAD-VALUE',author:'astra',baseVersion:'0.1.0',summary:'invalid token value',changes:[{path:'tokens.radius.md.$value',value:{$type:'dimension',$value:'12px'}}],tradeoffs:[],unresolved:[]};
  service.createProposal('BAD-VALUE',proposal,'admin','admin');
  const result=service.evaluateProposal('BAD-VALUE','admin','admin');
  assert.equal(result.valid,false);
  assert.ok(result.deterministicErrors.some(error=>error.includes('STYLE-TOKEN-004')));
});
test('candidate evaluation rejects a shadow name instead of a CSS shadow value',async()=>{
  const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});
  const proposal={id:'BAD-SHADOW',author:'astra',baseVersion:'0.1.0',summary:'invalid shadow',changes:[{path:'tokens.elevation.md.$value',value:"'lg'"}],tradeoffs:[],unresolved:[]};
  service.createProposal('BAD-SHADOW',proposal,'admin','admin');
  const result=service.evaluateProposal('BAD-SHADOW','admin','admin');
  assert.equal(result.valid,false);
  assert.ok(result.deterministicErrors.some(error=>error.includes('STYLE-TOKEN-004')));
});
test('candidate evaluation rejects changes that leave the canonical value unchanged',async()=>{
  const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});
  const proposal={id:'NO-OP',author:'astra',baseVersion:'0.1.0',summary:'unchanged',changes:[{path:'tokens.color.red.600.$value',value:'#DC2626'}],tradeoffs:[],unresolved:[]};
  service.createProposal('NO-OP',proposal,'admin','admin');
  const result=service.evaluateProposal('NO-OP','admin','admin');
  assert.equal(result.valid,false);
  assert.ok(result.deterministicErrors.some(error=>error.includes('does not change')));
});
test('governed candidate can add a complete token leaf and a component token mapping',async()=>{
  const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});
  const base={baseVersion:'0.1.0',summary:'disabled button semantics',tradeoffs:[],unresolved:[]};
  service.createProposal('ADD-A',{...base,id:'ADD-A',author:'astra',changes:[{path:'tokens.semantic.action.primary.disabledBackground',value:{$type:'color',$value:'{color.slate.200}'}}]},'admin','admin');
  service.createProposal('ADD-F',{...base,id:'ADD-F',author:'fable',changes:[{path:'components.button.tokens.disabledBackground',value:'{semantic.action.primary.disabledBackground}'}]},'admin','admin');
  const result=await service.startConsensusRound('ADD-A','ADD-F','admin','admin');
  assert.equal(result.status,'candidate_ready',JSON.stringify(result));
  assert.equal(result.candidate.changes.length,2);
  assert.equal(service.getConsensusStatus(result.candidateHash,'admin','admin').changeCount,2);
  assert.throws(()=>service.getDesignTokens('semantic.action.primary.disabledBackground'),/Unknown token scope/);
});
test('governed additions reject missing parents, unsafe keys, and incomplete token leaves',async()=>{
  const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});
  const base={baseVersion:'0.1.0',summary:'bad addition',tradeoffs:[],unresolved:[]};
  for(const [id,path,value] of [
    ['BAD-PARENT','tokens.newFamily.item',{$type:'color',$value:'#FFFFFF'}],
    ['BAD-KEY','tokens.semantic.action.primary.__proto__',{$type:'color',$value:'#FFFFFF'}],
    ['BAD-DOTS','tokens.semantic.action..disabledBackground',{$type:'color',$value:'#FFFFFF'}],
    ['BAD-LEAF','tokens.semantic.action.primary.disabledBackground',{$value:'#FFFFFF'}],
  ]){
    service.createProposal(id,{...base,id,author:'astra',changes:[{path,value}]},'admin','admin');
    assert.equal(service.evaluateProposal(id,'admin','admin').valid,false,id);
  }
});

test('governed candidate can extend accessibility rules, contrast pairs, and a form pattern',async()=>{
  const b=await loadBundle();
  const form=await loadJson('spec/patterns/form.json');
  const service=new StyleService({...b,principles:{},patterns:[form],antiPatterns:{},decisions:{}});
  const base={baseVersion:'0.1.0',summary:'input error guidance',tradeoffs:[],unresolved:[]};
  const rule={id:'STYLE-A11Y-007',name:'Error identification',requirement:'Describe detected input errors in text.'};
  const pair={id:'STYLE-A11Y-008',foreground:'semantic.text.danger',background:'semantic.surface.primary',minimum:4.5};
  service.createProposal('DOMAIN-A',{...base,id:'DOMAIN-A',author:'astra',changes:[
    {path:'accessibility.rules',value:[...b.accessibility.rules,rule]},
    {path:'patterns.form.rules',value:[...form.rules,'Identify each affected field in error text.']},
  ]},'admin','admin');
  service.createProposal('DOMAIN-F',{...base,id:'DOMAIN-F',author:'fable',changes:[
    {path:'accessibility.contrastPairs',value:[...b.accessibility.contrastPairs,pair]},
    {path:'components.input.accessibility.errorTextRequired',value:true},
  ]},'admin','admin');
  const result=await service.startConsensusRound('DOMAIN-A','DOMAIN-F','admin','admin');
  assert.equal(result.status,'candidate_ready',JSON.stringify(result));
  assert.equal(result.candidate.changes.length,4);
  assert.equal(service.getConsensusStatus(result.candidateHash,'admin','admin').changeCount,4);
  assert.equal(service.getComponentRules('input').accessibility.errorTextRequired,undefined);
});

test('governed accessibility and pattern changes reject dropped rules and malformed pairs',async()=>{
  const b=await loadBundle();
  const form=await loadJson('spec/patterns/form.json');
  const service=new StyleService({...b,principles:{},patterns:[form],antiPatterns:{},decisions:{}});
  const base={baseVersion:'0.1.0',summary:'invalid design change',tradeoffs:[],unresolved:[]};
  for(const [id,path,value] of [
    ['DROP-RULE','accessibility.rules',b.accessibility.rules.slice(1)],
    ['DROP-PATTERN','patterns.form.rules',form.rules.slice(1)],
    ['BAD-PAIR','accessibility.contrastPairs',[...b.accessibility.contrastPairs,{id:'STYLE-A11Y-008',foreground:'missing.token',background:'semantic.surface.primary',minimum:4.5}]],
    ['BAD-ACCESS','components.input.accessibility.errorTextRequired','yes'],
  ]){
    service.createProposal(id,{...base,id,author:'astra',changes:[{path,value}]},'admin','admin');
    assert.equal(service.evaluateProposal(id,'admin','admin').valid,false,id);
  }
});

test('operator governance view records conflict, candidate, approval, and readiness without exposing proposal values',async()=>{
  const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});
  const mk=(id,author,value)=>({id,author,baseVersion:'0.1.0',summary:'radius',changes:[{path:'tokens.radius.md.$value',value}],tradeoffs:[],unresolved:[]});
  service.createProposal('GV-A',mk('GV-A','astra','10px'),'admin','admin');
  service.createProposal('GV-F',mk('GV-F','fable','12px'),'admin','admin');
  assert.throws(()=>service.getGovernanceActivity(undefined,'admin'),/Unauthorized/);
  const conflict=await service.startConsensusRound('GV-A','GV-F','admin','admin');
  assert.equal(conflict.status,'needs_revision');
  let view=service.getGovernanceActivity('admin','admin');
  assert.equal(view.durable,false);
  assert.equal(view.identityAssurance,'shared-admin-credential');
  assert.equal(view.recentRuns[0].status,'needs_revision');
  assert.deepEqual(view.recentRuns[0].conflictPaths,['tokens.radius.md.$value']);
  assert.equal(view.candidates.length,0);
  assert.equal(JSON.stringify(view).includes('12px'),false);
  service.createProposal('GV-F2',mk('GV-F2','fable','10px'),'admin','admin');
  const ready=await service.startConsensusRound('GV-A','GV-F2','admin','admin');
  assert.equal(ready.status,'candidate_ready');
  assert.throws(()=>service.getConsensusStatus(ready.candidateHash,undefined,'admin'),/Unauthorized/);
  assert.equal(service.getConsensusStatus(ready.candidateHash,'admin','admin').roleApprovalsComplete,false);
  service.approveCandidate(ready.candidateHash,'astra','admin','admin');
  service.approveCandidate(ready.candidateHash,'fable','admin','admin');
  view=service.getGovernanceActivity('admin','admin');
  assert.equal(view.candidates[0].candidateHash,ready.candidateHash);
  assert.equal(view.candidates[0].roleApprovalsComplete,true);
  assert.equal(view.candidates[0].humanApprovalRequired,true);
  assert.equal(view.candidates[0].status,'candidate');
  assert.equal(view.recentRuns[0].status,'candidate_ready');
});

test('operator governance view records provider failure without a candidate or raw error text',async()=>{
  const b=await loadBundle();const service=new StyleService({...b,principles:{},patterns:[],antiPatterns:{},decisions:{}});
  const {MockAgent}=await import('../dist/packages/provider-adapters/src/index.js');
  const astra={id:'astra',generateProposal:async()=>{throw new Error('private provider response');}};
  const fable=new MockAgent('fable');
  await assert.rejects(service.generateCandidateFromBrief({brief:'A settings interface',criteria:['consistency'],astra,fable},'admin','admin'),/private provider response/);
  const view=service.getGovernanceActivity('admin','admin');
  assert.equal(view.recentRuns[0].status,'provider_error');
  assert.equal(view.candidates.length,0);
  assert.equal(JSON.stringify(view).includes('private provider response'),false);
});
