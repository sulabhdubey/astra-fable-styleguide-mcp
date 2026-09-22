import {readFile,writeFile,stat,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadProject,snapshotProject,previewRepair,applyRepair,undoRepair,startProjectServer} from './project-workflow.mjs';
import {verifyProject} from './verify-project.mjs';
import {createRepairPacket} from '../packages/browser-verification/src/index.mjs';
export async function readJson(path) {
  const info=await stat(path);if(!info.isFile()||info.size>15_000_000)throw new Error('Unsupported JSON input size');
  return JSON.parse(await readFile(path,'utf8'));
}
export async function inspectReport(project,result) {
  const report=result.report??result;const snapshot=await snapshotProject(project);
  if(report.artifactSha256!==snapshot.artifactSha256||report.specSha256!==snapshot.contract.specSha256)throw new Error('Stale report; verify the current project');
  if(!Array.isArray(report.checks)||!report.checks.length||report.checks.some(c=>!c||!['pass','fail','unsupported','not_checked'].includes(c.status)||typeof c.check!=='string'||typeof c.ruleId!=='string'||typeof c.target!=='string'))throw new Error('Invalid report checks');
  const status=report.checks.some(c=>c.status==='fail')?'fail':report.checks.every(c=>c.status==='pass')?'pass':'not_checked';
  if(report.status!==status)throw new Error('Report status disagrees with checks');
  return {status,artifactSha256:report.artifactSha256,specSha256:report.specSha256,checks:report.checks.length,findings:report.checks.filter(c=>c.status!=='pass'),exitCode:status==='pass'?0:status==='fail'?1:2};
}
export async function verifyConfiguredProject({tab,configPath,origin,outputPath}) {
  const project=await loadProject(configPath);
  const output=resolve(outputPath),parent=await realpath(dirname(output));
  const rel=relative(project.root,parent);
  if(!rel||(!(rel==='..'||rel.startsWith('..'+sep))&&!isAbsolute(rel)))throw new Error('Save reports outside the served project');
  const result=await verifyProject(tab,origin);
  const summary=await inspectReport(project,result);
  await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return summary;
}
export async function exportRepairPacket(project,result,outputPath) {
  await inspectReport(project,result);
  const report=result.report??result;
  const parent=await realpath(dirname(resolve(outputPath))),rel=relative(project.root,parent);
  if(!rel||(!(rel==='..'||rel.startsWith('..'+sep))&&!isAbsolute(rel)))throw new Error('Save repair packets outside the served project');
  const packet=createRepairPacket({report,expectedSpecSha256:report.specSha256,expectedArtifactSha256:report.artifactSha256,targetPaths:project.config.targetPaths});
  await writeFile(outputPath,JSON.stringify(packet,null,2)+'\n',{flag:'wx',mode:0o600});
  return {findings:packet.findings.length,artifactSha256:packet.artifactSha256};
}
export async function main([command,configPath,...args]) {
  if(!command||!configPath)throw new Error('Usage: project-cli.mjs validate|serve|report|packet|preview|apply|undo <project.json> [arguments]');
  const project=await loadProject(configPath);
  if(command==='validate')return {valid:true,...await snapshotProject(project).then(s=>({artifactSha256:s.artifactSha256,specSha256:s.contract.specSha256}))};
  if(command==='serve') {const port=Number(args[0]??0);if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid port');const server=await startProjectServer(project,port);return {origin:`http://127.0.0.1:${server.address().port}`};}
  if(command==='report')return inspectReport(project,await readJson(args[0]));
  if(command==='packet')return exportRepairPacket(project,await readJson(args[0]),args[1]);
  if(command==='preview')return previewRepair(project,await readJson(args[0]),await readJson(args[1]));
  if(command==='apply')return applyRepair(project,await readJson(args[0]),await readJson(args[1]),{receiptDirectory:args[2]});
  if(command==='undo')return undoRepair(project,args[0],{receiptDirectory:args[1]});
  throw new Error('Unknown project command');
}
if(typeof process!=='undefined' && process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const result=await main(process.argv.slice(2));console.log(JSON.stringify(result,null,2));process.exitCode=result.exitCode??0;}
  catch(error){console.error(error.message);process.exitCode=2;}
}
