import {readdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function cliOutputFingerprint(directory) {
  const files=[];
  async function walk(prefix='') {
    for(const entry of await readdir(resolve(directory,prefix),{withFileTypes:true})) {
      const name=prefix+entry.name;
      if(name==='build-input.json')continue;
      if(entry.isDirectory())await walk(name+'/');
      else if(entry.isFile())files.push([name,hash(await readFile(resolve(directory,name)))]);
      else throw new Error('Unsupported CLI output link');
    }
  }
  await walk();files.sort(([a],[b])=>a.localeCompare(b));
  return {sha256:hash(JSON.stringify(files)),files:files.length};
}

export async function cliInputFingerprint(root) {
  const inputs=[];
  async function walk(path) {
    for(const entry of (await readdir(resolve(root,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if(['node_modules','dist','.astro'].includes(entry.name))continue;
      const name=`${path}/${entry.name}`;
      if(entry.isDirectory())await walk(name);
      else if(entry.isFile())inputs.push([name,hash(await readFile(resolve(root,name)))]);
      else throw new Error('Unsupported CLI input link');
    }
  }
  for(const path of ['packages','scripts','spec','examples/profile','generated/css'])await walk(path);
  for(const path of ['package.json','pnpm-lock.yaml','tsconfig.core.json'])inputs.push([path,hash(await readFile(resolve(root,path)))]);
  inputs.sort(([a],[b])=>a.localeCompare(b));
  return {sha256:hash(JSON.stringify(inputs)),files:inputs.length};
}
