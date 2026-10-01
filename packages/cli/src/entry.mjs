#!/usr/bin/env node
import {stat,realpath,writeFile,readFile} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {runCheck,formatReport} from './runtime/scripts/standalone-check.mjs';
import {main as projectCommand,readJson} from './runtime/scripts/project-cli.mjs';
import {prepareDemo} from './runtime/scripts/prepare-demo.mjs';
import {initCommand} from './runtime/scripts/project-init.mjs';
import {pinConstitution} from './runtime/scripts/constitution.mjs';
import {startStudio} from './runtime/scripts/studio.mjs';
import {importCssSuggestions,createConstitutionCandidate,exportConstitutionCandidate} from './runtime/scripts/constitution-authoring.mjs';
import {captureGitEvidence,compareGitEvidence,renderPrSummary} from './runtime/scripts/ci-report.mjs';
const args=process.argv.slice(2);
const help=`stylecon validate [--root <spec-repository>]
stylecon init <project-directory> [--files index.html,app.css --trigger '#open' --dialog '#dialog' --close '#close' --name 'Title' --yes]
stylecon constitution pin <spec-repository> <new-snapshot.json>
stylecon constitution import <local.css>
stylecon constitution propose <spec-repository> <changes.json> <new-candidate.json>
stylecon constitution export <spec-repository> <candidate.json> <approved-sha256> <new-directory>
stylecon studio <workspace> --evidence <existing-private-directory>
stylecon ci capture <project.json> <new-private-receipt.json>
stylecon ci compare <base-receipt.json> <head-receipt.json> [--format markdown|json]
stylecon browser-install
stylecon doctor
stylecon demo <new-absolute-directory>
stylecon check|report <project-directory|project.json> [--format text|json|sarif|html] [--output <new-private-file>] [--compare <previous-report.json>]
stylecon packet <project.json> <report.json> <new-private-packet.json>
stylecon repair preview|apply|undo <project.json> <arguments...>
Repair arguments match the documented project workflow. Check never edits source.
Exit codes: 0 recorded pass; 1 violations; 2 usage, runtime error or incomplete checks.`;
try {
  if(!args.length||args[0]==='--help'){console.log(help);}
  else if(args[0]==='validate'){await import('./validate.mjs');}
  else if(args[0]==='init'){console.log(JSON.stringify(await initCommand(args.slice(1)),null,2));}
  else if(args[0]==='constitution'&&args[1]==='pin'&&args.length===4){console.log(JSON.stringify(await pinConstitution(resolve(args[2]),resolve(args[3])),null,2));}
  else if(args[0]==='constitution'&&args[1]==='import'&&args.length===3){const path=resolve(args[2]);if((await stat(path)).size>1_000_000)throw new Error('CSS file too large');console.log(JSON.stringify(importCssSuggestions(await readFile(path,'utf8')),null,2));}
  else if(args[0]==='constitution'&&args[1]==='propose'&&args.length===5){const candidate=await createConstitutionCandidate(resolve(args[2]),await readJson(resolve(args[3])));await writeFile(resolve(args[4]),JSON.stringify(candidate,null,2)+'\n',{flag:'wx',mode:0o600});console.log(candidate.candidateSha256);}
  else if(args[0]==='constitution'&&args[1]==='export'&&args.length===6){console.log(JSON.stringify(await exportConstitutionCandidate(resolve(args[2]),await readJson(resolve(args[3])),args[4],resolve(args[5])),null,2));}
  else if(args[0]==='studio'&&args.length===4&&args[2]==='--evidence'){
    const studio=await startStudio({workspace:resolve(args[1]),evidenceDirectory:resolve(args[3])});console.log(`Open locally: ${studio.url}\nKeep this session link private. Stop with Ctrl+C.`);
    process.once('SIGINT',()=>{studio.close().then(()=>process.exit(0));});
  } else if(args[0]==='ci'&&args[1]==='capture'&&args.length===4){
    const config=await realpath(resolve(args[2])),output=resolve(args[3]);const rel=relative(dirname(config),await realpath(dirname(output)));
    if(!rel||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep)))throw new Error('Receipts must be outside the checked project');
    const receipt=await captureGitEvidence(config,runCheck);await writeFile(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.log(receipt.evidenceSha256);
  } else if(args[0]==='ci'&&args[1]==='compare'&&(args.length===4||(args.length===6&&args[4]==='--format'&&['markdown','json'].includes(args[5])))){
    const result=compareGitEvidence(await readJson(resolve(args[2])),await readJson(resolve(args[3])));process.stdout.write((args[5]==='json'?JSON.stringify(result,null,2):renderPrSummary(result))+'\n');process.exitCode=result.exitCode;
  }
  else if(args[0]==='browser-install'&&args.length===1){
    const require=createRequire(import.meta.url);
    const result=spawnSync(process.execPath,[resolve(dirname(require.resolve('playwright/package.json')),'cli.js'),'install','chromium'],{stdio:'inherit'});
    if(result.error)throw result.error;process.exitCode=result.status??2;
  } else if(args[0]==='doctor'&&args.length===1){
    const {chromium}=await import('playwright');
    let installed=false;try{installed=(await stat(chromium.executablePath())).isFile();}catch{}
    console.log(JSON.stringify({browserInstalled:installed,node:process.version,next:installed?'stylecon check <project>':'stylecon browser-install'}));process.exitCode=installed?0:2;
  } else if(args[0]==='demo'&&args.length===2){console.log(JSON.stringify(await prepareDemo(resolve(args[1])),null,2));}
  else if(['check','report'].includes(args[0])) {
    if(!args[1])throw new Error('A project directory or project.json is required');
    let format='text',output,previous;
    for(let i=2;i<args.length;i+=2){if(!['--format','--output','--compare'].includes(args[i]))throw new Error('Unknown option');if(!args[i+1])throw new Error('Missing option value');if(args[i]==='--format')format=args[i+1];else if(args[i]==='--compare')previous=await readJson(resolve(args[i+1]));else output=resolve(args[i+1]);}
    if(!['text','json','sarif','html'].includes(format))throw new Error('Format must be text, json, sarif or html');
    if(previous&&format!=='html')throw new Error('--compare requires --format html');
    let config=resolve(args[1]);if((await stat(config)).isDirectory())config=resolve(config,'project.json');
    config=await realpath(config);
    if(output){const root=await realpath(dirname(config));const parent=await realpath(dirname(output));const rel=relative(root,parent);if(!rel||(!(rel==='..'||rel.startsWith('..'+sep))&&!isAbsolute(rel)))throw new Error('Reports must be outside the served project');}
    const {result,summary,targetPaths}=await runCheck(config);
    const rendered=formatReport(result,targetPaths,format,{previous})+'\n';
    if(output)await writeFile(output,rendered,{flag:'wx',mode:0o600});else process.stdout.write(rendered);
    process.exitCode=summary.exitCode;
  } else if(args[0]==='packet'||args[0]==='repair') {
    const commandArgs=args[0]==='repair'?args.slice(1):args;
    if(!['packet','preview','apply','undo'].includes(commandArgs[0]))throw new Error('Unknown repair command');
    if(commandArgs.length!==({packet:4,preview:4,apply:5,undo:4})[commandArgs[0]])throw new Error('Wrong number of repair arguments; use --help');
    console.log(JSON.stringify(await projectCommand(commandArgs),null,2));
  } else throw new Error('Unknown command; use --help');
} catch(error) {
  if(args.includes('json'))console.error(JSON.stringify({status:'not_checked',error:error.message}));
  else console.error(error.message);
  process.exitCode=2;
}
