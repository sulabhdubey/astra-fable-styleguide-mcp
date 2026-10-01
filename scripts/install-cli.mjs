import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,basename,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';

function tarNumber(header,start,length) {
  const text=header.subarray(start,start+length).toString('ascii').replace(/\0.*$/,'').trim();
  if (!/^[0-7]+$/.test(text)) throw new Error('Malformed CLI archive');
  return Number.parseInt(text,8);
}
function archivePackage(archive) {
  let tar;
  try { tar=gunzipSync(archive,{maxOutputLength:20_000_000}); } catch { throw new Error('Malformed or oversized CLI archive'); }
  let offset=0,manifest;
  while(offset+512<=tar.length) {
    const header=tar.subarray(offset,offset+512);if(header.every(byte=>byte===0))break;
    const expected=tarNumber(header,148,8),actual=header.reduce((sum,byte,index)=>sum+(index>=148&&index<156?32:byte),0);
    if(expected!==actual)throw new Error('Malformed CLI archive');
    const size=tarNumber(header,124,12),name=header.subarray(0,100).toString('utf8').replace(/\0.*$/,'');
    const contentStart=offset+512,contentEnd=contentStart+size;if(!name||contentEnd>tar.length)throw new Error('Malformed CLI archive');
    if(name==='package/package.json') {
      if(manifest||size>64_000)throw new Error('Malformed CLI archive');
      try { manifest=JSON.parse(tar.subarray(contentStart,contentEnd).toString('utf8')); } catch { throw new Error('Malformed CLI archive package metadata'); }
    }
    offset=contentStart+Math.ceil(size/512)*512;
  }
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||manifest.name!=='@styleconstitution/cli'||typeof manifest.version!=='string'||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)||!manifest.bin||typeof manifest.bin!=='object'||Array.isArray(manifest.bin)||manifest.bin.stylecon!=='dist/stylecon.mjs')throw new Error('Untrusted CLI archive package metadata');
  return {name:manifest.name,version:manifest.version,bin:manifest.bin.stylecon};
}

export async function installVerifiedArchive(archivePath,checksumPath,destination,{run=spawnSync,offline=false}={}) {
  const archive=resolve(archivePath),name=basename(archive),target=resolve(destination);
  if(!/^[A-Za-z0-9._-]+\.tgz$/.test(name))throw new Error('Expected a local CLI .tgz archive');
  for(const [path,limit] of [[archive,8_000_000],[checksumPath,16_000]]){
    const info=await stat(path);if(!info.isFile()||info.size>limit)throw new Error('Unsupported installer input');
  }
  const bytes=await readFile(archive),sha256=createHash('sha256').update(bytes).digest('hex');
  const lines=(await readFile(checksumPath,'utf8')).trim().split(/\r?\n/).filter(line=>line.endsWith(`  ${name}`));
  if(lines.length!==1||lines[0]!==`${sha256}  ${name}`)throw new Error('Archive checksum mismatch; no installation performed');
  const packageIdentity=archivePackage(bytes);
  // A new directory and a copy of already verified bytes eliminate archive path replacement races.
  await mkdir(target,{mode:0o700});
  const staged=join(target,name);await writeFile(staged,bytes,{flag:'wx',mode:0o600});
  await writeFile(join(target,'package.json'),JSON.stringify({name:'stylecon-local-consumer',private:true},null,2)+'\n',{flag:'wx'});
  const args=['install','--ignore-scripts','--save-exact','--no-audit','--no-fund',...(offline?['--offline']:[]),staged];
  const npm=join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  const result=run(process.platform==='win32'?process.execPath:'npm',process.platform==='win32'?[npm,...args]:args,{cwd:target,stdio:'inherit',timeout:240000});
  if(result.error||result.status!==0)throw new Error('Installation failed; verified files remain in the destination for inspection');
  let installed;
  try { installed=JSON.parse(await readFile(join(target,'node_modules','@styleconstitution','cli','package.json'),'utf8')); } catch { throw new Error('Installed CLI package metadata is unavailable'); }
  if(!installed||installed.name!==packageIdentity.name||installed.version!==packageIdentity.version||!installed.bin||typeof installed.bin!=='object'||installed.bin.stylecon!==packageIdentity.bin)throw new Error('Installed CLI package metadata does not match the verified archive');
  const entry=await stat(join(target,'node_modules','@styleconstitution','cli',packageIdentity.bin));
  if(!entry.isFile())throw new Error('Installed CLI entry point is unavailable');
  const receipt={sha256,archive:name,package:packageIdentity,installed:true,lifecycleScripts:false,browserInstalled:false,next:'Run npx --no-install stylecon browser-install, then stylecon studio <workspace> --evidence <private-directory>.'};
  await writeFile(join(target,'installation-evidence.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    const args=process.argv.slice(2);if(args.length!==3)throw new Error('Usage: node install-cli.mjs <reviewed-cli.tgz> <trusted-SHA256SUMS> <new-consumer-directory>');
    console.log(JSON.stringify(await installVerifiedArchive(...args),null,2));
  } catch(error){console.error(error.message);process.exitCode=2;}
}
