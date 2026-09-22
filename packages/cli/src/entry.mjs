#!/usr/bin/env node
import {stat,realpath,writeFile} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {runCheck,formatReport} from './runtime/scripts/standalone-check.mjs';
import {main as projectCommand} from './runtime/scripts/project-cli.mjs';
import {prepareDemo} from './runtime/scripts/prepare-demo.mjs';
const args=process.argv.slice(2);
const help=`stylecon validate [--root <spec-repository>]
stylecon browser-install
stylecon doctor
stylecon demo <new-absolute-directory>
stylecon check|report <project-directory|project.json> [--format text|json|sarif] [--output <new-private-file>]
stylecon packet <project.json> <report.json> <new-private-packet.json>
stylecon repair preview|apply|undo <project.json> <arguments...>
Repair arguments match the documented project workflow. Check never edits source.
Exit codes: 0 recorded pass; 1 violations; 2 usage, runtime error or incomplete checks.`;
try {
  if(!args.length||args[0]==='--help'){console.log(help);}
  else if(args[0]==='validate'){await import('./validate.mjs');}
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
    let format='text',output;
    for(let i=2;i<args.length;i+=2){if(!['--format','--output'].includes(args[i]))throw new Error('Unknown option');if(!args[i+1])throw new Error('Missing option value');if(args[i]==='--format')format=args[i+1];else output=resolve(args[i+1]);}
    if(!['text','json','sarif'].includes(format))throw new Error('Format must be text, json or sarif');
    let config=resolve(args[1]);if((await stat(config)).isDirectory())config=resolve(config,'project.json');
    config=await realpath(config);
    if(output){const root=await realpath(dirname(config));const parent=await realpath(dirname(output));const rel=relative(root,parent);if(!rel||(!(rel==='..'||rel.startsWith('..'+sep))&&!isAbsolute(rel)))throw new Error('Reports must be outside the served project');}
    const {result,summary,targetPaths}=await runCheck(config);
    const rendered=formatReport(result,targetPaths,format)+'\n';
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
