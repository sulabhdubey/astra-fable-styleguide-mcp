import {mkdir,copyFile,constants} from 'node:fs/promises';
import {join,dirname} from 'node:path';

// Positive inventory: local .env, dependency trees and build output must never ship.
export const starterFiles=['README.md','PILOT_FEEDBACK.md','gitignore.txt','project/package.json','project/package-lock.json','project/project.json','project/index.html','project/vite.config.mjs','project/src/main.mjs','project/src/Components.stories.mjs','project/src/harness.mjs'];
export async function copyStarterFiles(source,destination,{projectOnly=false}={}){
  for(const file of starterFiles.filter(file=>!projectOnly||file.startsWith('project/'))){
    const output=join(destination,file);await mkdir(dirname(output),{recursive:true});await copyFile(join(source,file),output,constants.COPYFILE_EXCL);
  }
}
