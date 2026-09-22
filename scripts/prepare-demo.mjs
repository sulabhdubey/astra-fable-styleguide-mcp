import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repository=fileURLToPath(new URL('../',import.meta.url));
export async function prepareDemo(destination) {
  if(typeof destination!=='string'||!isAbsolute(destination))throw new Error('Choose a new absolute directory; its parent must already exist');
  const original=await readFile(resolve(repository,'examples/profile/index.html'),'utf8');
  const after='#review{min-height:var(--size-control-md);padding:var(--space-2) var(--space-4)}';
  const before='#review{height:24px;min-height:24px;padding:0 var(--space-4)}';
  if(original.split(after).length!==2)throw new Error('Demo source changed; review the fixture before preparing it');
  const config=await readFile(resolve(repository,'examples/profile/project.json'),'utf8');
  await mkdir(destination); // Exclusive: never replace an existing project.
  const project=resolve(destination,'project'),evidence=resolve(destination,'evidence');
  await mkdir(project);await mkdir(evidence);
  await writeFile(resolve(project,'index.html'),original.replace(after,()=>before),{flag:'wx'});
  await writeFile(resolve(project,'project.json'),config,{flag:'wx'});
  await writeFile(resolve(destination,'change.json'),JSON.stringify({path:'index.html',before,after},null,2)+'\n',{flag:'wx'});
  return {project:resolve(project,'project.json'),evidence,change:resolve(destination,'change.json'),intentionalDefect:'Review name button is 24px high; canonical target minimum is 40px. This is a synthetic rehearsal.'};
}
if(typeof process!=='undefined'&&process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{console.log(JSON.stringify(await prepareDemo(process.argv[2]),null,2));}
  catch(error){console.error(error.message);process.exitCode=2;}
}
