import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { canonicalize } from '../dist/packages/style-spec/src/index.js';

const [cmd,...args]=process.argv.slice(2);
const run=(bin,argv)=>{const r=spawnSync(bin,argv,{stdio:'inherit',shell:process.platform==='win32'});process.exitCode=r.status??1;};
if(!cmd||cmd==='help'){
  console.log('stylecon validate|build|inspect|diff <a.json> <b.json>|consensus|generate|mcp');
}else if(cmd==='validate') run('npm',['run','validate']);
else if(cmd==='build') run('npm',['run','build:portable']);
else if(cmd==='generate') run('npm',['run','generate']);
else if(cmd==='inspect'){
  const m=JSON.parse(await readFile('spec/manifest.json','utf8')); console.log(JSON.stringify({name:m.name,version:m.version,status:m.status,principles:m.principles},null,2));
}else if(cmd==='diff'){
  if(args.length<2) throw new Error('diff requires two JSON paths');
  const a=JSON.parse(await readFile(args[0],'utf8')), b=JSON.parse(await readFile(args[1],'utf8'));
  console.log(canonicalize(a)===canonicalize(b)?'No semantic JSON difference.':'Semantic JSON differs.');
  if(canonicalize(a)!==canonicalize(b)) process.exitCode=2;
}else if(cmd==='consensus'){
  const {runConsensus}=await import('../dist/packages/consensus-engine/src/index.js');
  const {MockAgent}=await import('../dist/packages/provider-adapters/src/index.js');
  const mk=(id,author,value)=>({id,author,baseVersion:'0.1.0',summary:'CLI demo',changes:[{path:'demo.radius',value}],tradeoffs:[],unresolved:[]});
  const astra=new MockAgent('astra',{initial:mk('A','astra','8px'),convergeTo:{'demo.radius':'10px'}});
  const fable=new MockAgent('fable',{initial:mk('F','fable','12px'),convergeTo:{'demo.radius':'10px'}});
  console.log(JSON.stringify(await runConsensus({astra,fable,context:{brief:'CLI consensus demo',criteria:['consistency'],baseVersion:'0.1.0'}}),null,2));
}else if(cmd==='mcp'){
  run('pnpm',['exec','tsx','apps/mcp-server/src/official-server.ts']);
}else{console.error(`Unknown command: ${cmd}`);process.exitCode=1;}
