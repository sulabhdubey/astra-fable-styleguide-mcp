import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,access,rm,readFile} from 'node:fs/promises';
import {mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {installVerifiedArchive} from '../scripts/install-cli.mjs';

const cliManifest={name:'@styleconstitution/cli',version:'0.6.0',bin:{stylecon:'dist/stylecon.mjs'}};
function tarEntry(name,content) {
  const body=Buffer.from(content),header=Buffer.alloc(512);
  header.write(name);header.write('0000644\0',100);header.write(`${body.length.toString(8).padStart(11,'0')}\0`,124);header.write('        ',148);header.write('0',156);header.write('ustar\0',257);header.write('00',263);
  const checksum=header.reduce((sum,byte)=>sum+byte,0);header.write(`${checksum.toString(8).padStart(6,'0')}\0 `,148);
  return Buffer.concat([header,body,Buffer.alloc((512-body.length%512)%512)]);
}
function cliArchive(manifest=cliManifest) {
  return gzipSync(Buffer.concat([tarEntry('package/package.json',JSON.stringify(manifest)),tarEntry('package/dist/stylecon.mjs','#!/usr/bin/env node\n'),Buffer.alloc(1024)]));
}
function installedRunner(manifest=cliManifest) {
  return (_command,_args,{cwd})=>{
    const packagePath=join(cwd,'node_modules','@styleconstitution','cli','package.json');
    const packageRoot=join(cwd,'node_modules','@styleconstitution','cli');
    mkdirSync(join(packageRoot,'dist'),{recursive:true});writeFileSync(packagePath,JSON.stringify(manifest));writeFileSync(join(packageRoot,'dist','stylecon.mjs'),'#!/usr/bin/env node\n');
    return {status:0};
  };
}

test('installer verifies archive bytes and trusted archive metadata before creating a destination or invoking npm',async()=>{
  const root=await mkdtemp(join(tmpdir(),'stylecon-install-'));
  try {
    const archive=join(root,'cli.tgz'),sums=join(root,'SHA256SUMS'),destination=join(root,'consumer');
    await writeFile(archive,cliArchive());await writeFile(sums,`${'0'.repeat(64)}  cli.tgz\n`);
    let invoked=false;const run=()=>{invoked=true;return {status:0};};
    await assert.rejects(installVerifiedArchive(archive,sums,destination,{run}),/checksum/);
    assert.equal(invoked,false);await assert.rejects(access(destination));
    const sha=createHash('sha256').update(await readFile(archive)).digest('hex');await writeFile(sums,`${sha}  cli.tgz\n`);
    const result=await installVerifiedArchive(archive,sums,destination,{run:installedRunner()});
    assert.equal(result.sha256,sha);assert.deepEqual(result.package,{name:'@styleconstitution/cli',version:'0.6.0',bin:'dist/stylecon.mjs'});
    assert.equal(JSON.parse(await readFile(join(destination,'installation-evidence.json'),'utf8')).package.version,'0.6.0');
    await assert.rejects(installVerifiedArchive(archive,sums,destination,{run:installedRunner()}),/exist/i);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('installer rejects an untrusted archive package and an installed package that differs from the verified archive',async()=>{
  const root=await mkdtemp(join(tmpdir(),'stylecon-install-metadata-'));
  try {
    const archive=join(root,'cli.tgz'),sums=join(root,'SHA256SUMS');
    await writeFile(archive,cliArchive({name:'other-cli',version:'0.6.0',bin:{stylecon:'dist/stylecon.mjs'}}));
    await writeFile(sums,`${createHash('sha256').update(await readFile(archive)).digest('hex')}  cli.tgz\n`);
    let invoked=false;
    await assert.rejects(installVerifiedArchive(archive,sums,join(root,'wrong-package'),{run:()=>{invoked=true;return {status:0};}}),/archive package/i);
    assert.equal(invoked,false);

    await writeFile(archive,cliArchive());await writeFile(sums,`${createHash('sha256').update(await readFile(archive)).digest('hex')}  cli.tgz\n`);
    await assert.rejects(installVerifiedArchive(archive,sums,join(root,'wrong-installed'),{run:installedRunner({...cliManifest,version:'9.9.9'})}),/installed.*package metadata/i);
    await assert.rejects(access(join(root,'wrong-installed','installation-evidence.json')));
  } finally {await rm(root,{recursive:true,force:true});}
});
