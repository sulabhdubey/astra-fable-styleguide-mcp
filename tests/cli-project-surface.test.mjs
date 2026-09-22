import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('packaged CLI discovers project checking and rejects unknown options',()=>{
  const help=spawnSync(process.execPath,['packages/cli/dist/stylecon.mjs','--help'],{encoding:'utf8'});
  assert.equal(help.status,0);assert.match(help.stdout,/check/);assert.match(help.stdout,/repair/);
  const invalid=spawnSync(process.execPath,['packages/cli/dist/stylecon.mjs','check','examples/profile','--unknown'],{encoding:'utf8'});
  assert.equal(invalid.status,2);assert.match(invalid.stderr,/Unknown option/);
});

test('config file symlinks cannot place reports inside the actual project',async t=>{
  const root=await mkdtemp(join(tmpdir(),'stylecon-config-link-'));
  try {
    const project=join(root,'project');await mkdir(project);
    const config=join(project,'project.json');await writeFile(config,'{}');
    const alias=join(root,'alias.json');
    try{await symlink(config,alias,'file');}catch(error){if(process.platform==='win32'&&error.code==='EPERM'){t.skip('File symlinks need Windows developer mode');return;}throw error;}
    const result=spawnSync(process.execPath,['packages/cli/dist/stylecon.mjs','check',alias,'--output',join(project,'report.json')],{encoding:'utf8'});
    assert.equal(result.status,2);assert.match(result.stderr,/Reports must be outside the served project/);
  } finally {await rm(root,{recursive:true,force:true});}
});
