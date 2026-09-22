import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {loadProject,snapshotProject} from '../scripts/project-workflow.mjs';
import {inspectReport} from '../scripts/project-cli.mjs';
test('report command rejects stale, empty and contradictory evidence',async()=>{
  const project=await loadProject('examples/profile/project.json'),snapshot=await snapshotProject(project);
  const report={artifactSha256:snapshot.artifactSha256,specSha256:snapshot.contract.specSha256,status:'pass',checks:[{check:'size',ruleId:'STYLE-A11Y-001',target:'#review',status:'pass'}]};
  assert.equal((await inspectReport(project,report)).exitCode,0);
  await assert.rejects(inspectReport(project,{...report,artifactSha256:'0'.repeat(64)}),/Stale/);
  await assert.rejects(inspectReport(project,{...report,checks:[]}),/Invalid/);
  await assert.rejects(inspectReport(project,{...report,status:'fail'}),/disagrees/);
  assert.equal((await inspectReport(project,{...report,status:'fail',checks:[{...report.checks[0],status:'fail'}]})).exitCode,1);
  assert.equal((await inspectReport(project,{...report,status:'not_checked',checks:[{...report.checks[0],status:'unsupported'}]})).exitCode,2);
});
test('configuration entry point runs from the documented command and errors are nonzero',()=>{
  const valid=spawnSync(process.execPath,['scripts/project-cli.mjs','validate','examples/profile/project.json'],{encoding:'utf8'});
  assert.equal(valid.status,0,valid.stderr);assert.equal(JSON.parse(valid.stdout).valid,true);
  const invalid=spawnSync(process.execPath,['scripts/project-cli.mjs','unknown','examples/profile/project.json'],{encoding:'utf8'});
  assert.equal(invalid.status,2);assert.match(invalid.stderr,/Unknown/);
});

test('browser host can import entry point without a process global',()=>{
  const result=spawnSync(process.execPath,['--input-type=module','-e',"delete globalThis.process; await import('./scripts/project-cli.mjs');"],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
