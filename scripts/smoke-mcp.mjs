import {spawn} from 'node:child_process';
const port=Number(process.env.SMOKE_MCP_PORT??43127);
const child=spawn(process.execPath,['--import','tsx','apps/mcp-server/src/official-server.ts'],{stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:String(port),HOST:'127.0.0.1',MCP_ENABLE_WRITES:'false'}});
let stderr='';child.stderr.on('data',d=>stderr+=String(d));
const deadline=Date.now()+15000;let response;
try{
  while(Date.now()<deadline){try{response=await fetch(`http://127.0.0.1:${port}/health`);if(response.ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
  if(!response?.ok)throw new Error(`MCP health smoke test failed. ${stderr.slice(-2000)}`);
  const body=await response.json();if(body.ok!==true||body.protocol!=='2026-07-28')throw new Error(`Unexpected health payload: ${JSON.stringify(body)}`);
  console.log(JSON.stringify({ok:true,health:body},null,2));
}finally{child.kill('SIGTERM');await new Promise(r=>{child.once('exit',r);setTimeout(r,2000)});}
