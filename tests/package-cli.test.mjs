import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyCliArchive} from '../scripts/verify-cli-archive.mjs';

test('development package binds archive checksum and source identity without claiming a release',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'style-package-'));
  try{
    const result=spawnSync(process.execPath,['scripts/package-cli.mjs',directory,'--development'],{encoding:'utf8',timeout:60000});
    assert.equal(result.status,0,result.stderr);
    const manifest=JSON.parse(await readFile(join(directory,'package-evidence.json'),'utf8'));
    assert.equal(manifest.channel,'development');assert.equal(manifest.releaseAuthorized,false);
    const archive=await readFile(join(directory,manifest.archive.filename));
    assert.equal(createHash('sha256').update(archive).digest('hex'),manifest.archive.sha256);
    assert.match(manifest.source.inputSha256,/^[a-f0-9]{64}$/);
    assert.match(await readFile(join(directory,'SHA256SUMS'),'utf8'),new RegExp(manifest.archive.sha256));
    assert.ok((await readdir(directory)).some(name=>name.endsWith('.tgz')));
    const verified=await verifyCliArchive(directory);
    assert.equal(verified.archive.sha256,manifest.archive.sha256);
    assert.equal(verified.cleanConsumer,true);
    assert.equal(verified.browserVerified,false);
    assert.equal(spawnSync(process.execPath,['scripts/package-cli.mjs',directory,'--development'],{encoding:'utf8'}).status,1);
  }finally{await rm(directory,{recursive:true,force:true});}
});
