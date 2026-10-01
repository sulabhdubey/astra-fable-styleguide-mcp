import test from 'node:test';
import assert from 'node:assert/strict';
import {appendProductChecks} from '../packages/browser-verification/src/product-checks.mjs';
import {renderHtmlReport,compareReports} from '../scripts/html-report.mjs';
const good=()=>({form:{selector:'#name',found:true,labelled:true,label:'Name',invalid:true,errorAssociated:true,errorVisible:true,focused:true},states:[{selector:'#disabled',kind:'disabled',found:true,nativeDisabled:true},{selector:'#loading',kind:'loading',found:true,busy:true,statusVisible:true}],layout:{viewportWidth:390,contentWidth:390},closePaths:[{closed:true,returnFocus:true}]});
const run=o=>appendProductChecks({checks:[]},o);
test('declared form, states, layout and close paths have positive and negative controls',()=>{
  assert.equal(run(good()).status,'pass');
  for(const [section,index,key,check] of [['form',null,'labelled','label'],['form',null,'errorAssociated','error-association'],['states',0,'nativeDisabled','disabled'],['states',1,'statusVisible','loading'],['closePaths',0,'returnFocus','close-path']]) {
    const o=good();(index===null?o[section]:o[section][index])[key]=false;
    assert.equal(run(o).checks.find(c=>c.check===check).status,'fail');
  }
  const o=good();o.layout.contentWidth=900;assert.equal(run(o).checks.find(c=>c.check==='overflow').status,'fail');
  o.form.found=false;assert.equal(run(o).checks.find(c=>c.check==='label').status,'not_checked');
});

test('multiple dialog close actions retain distinct report and comparison identities',()=>{
  const report=appendProductChecks({artifactSha256:'a'.repeat(64),specSha256:'b'.repeat(64),projectConfigurationSha256:'c'.repeat(64),checks:[]},{closePaths:[{selector:'#cancel',closed:true,returnFocus:true},{selector:'#confirm',closed:true,returnFocus:false}]});
  assert.equal(new Set(report.checks.map(c=>[c.ruleId,c.check,c.target].join('|'))).size,2);
  assert.match(renderHtmlReport(report,{'#cancel':'index.html','#confirm':'index.html'}),/#confirm/);
  const after=JSON.parse(JSON.stringify(report));after.checks[1].status='pass';after.status='pass';
  assert.equal(compareReports(after,report).resolved,1);
});

test('responsive observations retain viewport identity in HTML and comparisons',()=>{
  const report={artifactSha256:'a'.repeat(64),specSha256:'b'.repeat(64),projectConfigurationSha256:'c'.repeat(64),status:'fail',checks:[{ruleId:'overflow',check:'overflow',target:'#title',viewport:{width:1280},status:'pass'},{ruleId:'overflow',check:'overflow',target:'#title',viewport:{width:390},status:'fail'}]};
  assert.match(renderHtmlReport(report,{}),/verification report/);
  const after=JSON.parse(JSON.stringify(report));after.checks[1].status='pass';after.status='pass';assert.equal(compareReports(after,report).resolved,1);
});
