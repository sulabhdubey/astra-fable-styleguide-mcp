import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const files=['generated/css/tokens.css','generated/json/tokens.json','generated/json/style-spec.json','generated/typescript/tokens.ts'];
const run=()=>{const r=spawnSync(process.execPath,['scripts/generate-assets.mjs'],{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);};
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')])));
run();const first=await hashes();run();const second=await hashes();
if(JSON.stringify(first)!==JSON.stringify(second)){console.error('Generated artifacts are not reproducible',JSON.stringify({first,second},null,2));process.exit(1);}console.log(JSON.stringify({reproducible:true,sha256:second},null,2));
