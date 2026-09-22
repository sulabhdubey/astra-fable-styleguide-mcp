import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareDemo} from '../scripts/prepare-demo.mjs';
import {loadProject,snapshotProject} from '../scripts/project-workflow.mjs';
import {exportRepairPacket} from '../scripts/project-cli.mjs';

test('demo preparation is isolated; packet export rejects stale and public-path evidence',async()=>{
  const root=await mkdtemp(join(tmpdir(),'adoption-demo-')),destination=join(root,'demo');
  try {
    await assert.rejects(prepareDemo('relative-path'),/absolute/);
    const prepared=await prepareDemo(destination);
    const project=await loadProject(prepared.project),snapshot=await snapshotProject(project);
    assert.ok(snapshot.files['index.html'].includes('#review{height:24px;'));
    await assert.rejects(prepareDemo(destination),/EEXIST/);
    const report={status:'fail',artifactSha256:snapshot.artifactSha256,specSha256:snapshot.contract.specSha256,checks:[{check:'target',ruleId:'STYLE-A11Y-009',target:'#review',status:'fail',observed:{height:24},fix:'Use canonical minimum'}]};
    const output=join(prepared.evidence,'repair.json');
    assert.equal((await exportRepairPacket(project,report,output)).findings,1);
    assert.equal(JSON.parse(await readFile(output,'utf8')).findings[0].path,'index.html');
    await assert.rejects(exportRepairPacket(project,report,output),/EEXIST/);
    await assert.rejects(exportRepairPacket(project,{...report,artifactSha256:'0'.repeat(64)},join(prepared.evidence,'stale.json')),/Stale/);
    await assert.rejects(exportRepairPacket(project,report,join(destination,'project','packet.json')),/outside/);
  } finally {
    for(const name of ['project/index.html','project/project.json','change.json','evidence/repair.json'])await unlink(join(destination,name));
    await rmdir(join(destination,'project'));await rmdir(join(destination,'evidence'));await rmdir(destination);await rmdir(root);
  }
});
