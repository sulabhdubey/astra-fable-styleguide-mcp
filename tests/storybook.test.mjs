import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStorySelection,storyCompletionCheck,loadStorybookProject,supportedStoryVersions} from '../scripts/storybook-check.mjs';
import {openStudioHistory} from '../scripts/studio-history.mjs';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAgentBrief,findingId} from '../scripts/agent-brief.mjs';

const config={stories:[{id:'button--primary',measurements:[{target:'#button',selector:'#button',typography:{fontSize:'typography.fontSize.300'},spacing:{paddingTop:'space.4'}}]}]};
test('story selection binds nonempty known stories and rule groups',()=>{
  assert.deepEqual(validateStorySelection(config,{storyId:'button--primary',rules:['spacing']}),{storyId:'button--primary',rules:['spacing']});
  for(const selection of [{storyId:'missing',rules:['spacing']},{storyId:'button--primary',rules:[]},{storyId:'button--primary',rules:['other']}])assert.throws(()=>validateStorySelection(config,selection));
});
test('private history retains story screenshots and scope for later review',async()=>{
  const root=await mkdtemp(join(tmpdir(),'story-history-')),workspace=join(root,'workspace'),evidence=join(root,'evidence');await mkdir(workspace);await mkdir(evidence);
  const history=await openStudioHistory({workspace,evidenceDirectory:evidence});
  const report={schemaVersion:1,status:'not_checked',artifactSha256:'a'.repeat(64),specSha256:'b'.repeat(64),projectConfigurationSha256:'c'.repeat(64),checks:[storyCompletionCheck('button--primary',{status:'skipped'})],browserScope:{integration:'storybook-portable',selection:{storyId:'button--primary',rules:['spacing']}}};
  const previews=[{width:390,png:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII='}];
  const entry=await history.save({project:'.',checked:{result:{report,previews},targetPaths:{}}});
  const reopened=await (await openStudioHistory({workspace,evidenceDirectory:evidence})).read({project:'.',id:entry.id});
  assert.deepEqual(reopened.checked.result.previews,previews);
  assert.equal(reopened.checked.result.report.browserScope.selection.storyId,'button--primary');
});
test('skipped, failed, unfinished and wrong story completion never pass',()=>{
  for(const status of ['skipped','error','running',undefined])assert.equal(storyCompletionCheck('button--primary',{id:'button--primary',status}).status,'not_checked');
  assert.equal(storyCompletionCheck('button--primary',{id:'card--primary',status:'completed'}).status,'not_checked');
  assert.equal(storyCompletionCheck('button--primary',{id:'button--primary',status:'completed'}).status,'pass');
});
test('story project refuses unsupported versions, overlapping source, remote origins and empty rules',async()=>{
  const root=await mkdtemp(join(tmpdir(),'story-config-'));await mkdir(join(root,'src'));await mkdir(join(root,'dist'));
  await writeFile(join(root,'src/Story.mjs'),'source');await writeFile(join(root,'dist/index.html'),'built');await writeFile(join(root,'package.json'),'{}');
  const valid={schemaVersion:3,integration:'storybook-portable',url:'http://127.0.0.1:4193/',sourceDirectory:'src',buildDirectory:'dist',identityFiles:['package.json'],versions:supportedStoryVersions,stories:[{id:'button--primary',name:'Button',source:'src/Story.mjs',measurements:config.stories[0].measurements}]};
  const path=join(root,'project.json');await writeFile(path,JSON.stringify(valid));
  assert.equal((await loadStorybookProject(path)).stories.length,1);
  for(const update of [{url:'https://example.com/'},{url:'http://127.0.0.1:4193/other'},{buildDirectory:'src'},{versions:{...supportedStoryVersions,storybook:'10.6.4'}},{stories:[{...valid.stories[0],measurements:[]}]},{stories:[{...valid.stories[0],measurements:[{selector:'#sample',target:'#sample',spacing:{}}]}]}]){
    await writeFile(path,JSON.stringify({...valid,...update}));await assert.rejects(()=>loadStorybookProject(path));
  }
});
test('a story correction brief identifies the selected story, state and rules',()=>{
  const check={ruleId:'STYLE-MEASURE-SPACING',check:'spacing.paddingTop',target:'#sample',selector:'#sample',status:'fail',observed:'3px',expected:'16px'};
  const report={schemaVersion:1,status:'fail',artifactSha256:'a'.repeat(64),specSha256:'b'.repeat(64),projectConfigurationSha256:'c'.repeat(64),checks:[check],browserScope:{integration:'storybook-portable',selection:{storyId:'card--compact',rules:['spacing']},states:[{width:390,args:{compact:true},globals:{theme:'light'}}],versions:supportedStoryVersions}};
  const brief=createAgentBrief({report,targetPaths:{'#sample':'src/Card.stories.mjs'},selectedIds:[findingId(check)]});
  assert.equal(brief.scope.story.id,'card--compact');assert.deepEqual(brief.scope.story.rules,['spacing']);assert.equal(brief.scope.story.states[0].args.compact,true);
});
