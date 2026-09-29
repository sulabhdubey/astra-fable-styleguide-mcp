import {readFile, realpath, writeFile, unlink, readdir, stat} from 'node:fs/promises';
import {resolve, relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {loadProject, snapshotProject} from './project-workflow.mjs';

export async function initProject(directory,options) {
  const root=await realpath(directory);
  const files=options.files?.split(',').map(s=>s.trim());
  if(!files?.includes('index.html')||files.some(p=>!/^([A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(html|css|js)$/.test(p)))throw new Error('Choose relative HTML/CSS/JS files including index.html');
  const {trigger,dialog,close,name}=options;
  if([trigger,dialog,close].some(s=>!/^#[A-Za-z][\w-]*$/.test(s))||typeof name!=='string'||!name.trim())throw new Error('Choose trigger, dialog, close ID selectors and the visible dialog name');
  const config={schemaVersion:1,files,journey:{buttons:[trigger],trigger,dialog,close,name,dialogButtons:[close]},targetPaths:{[trigger]:'index.html',[close]:'index.html',dialog:'index.html',page:'index.html'}};
  if(options.constitution) {
    if(!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.json$/.test(options.constitution))throw new Error('Choose a relative constitution snapshot path');
    const snapshotPath=await realpath(resolve(root,options.constitution));
    if(relative(root,snapshotPath).replaceAll('\\','/').toLowerCase()!==options.constitution.toLowerCase())throw new Error('Unsafe constitution path or symlink');
    const info=await stat(snapshotPath);
    if(!info.isFile()||info.size>5_000_000)throw new Error('Constitution too large');
    const bytes=await readFile(snapshotPath);
    config.constitution={path:options.constitution,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  if(options.input||options.submit||options['valid-value']!==undefined||options['invalid-value']!==undefined) {
    if(!options.input||!options.submit||options['valid-value']===undefined||options['invalid-value']===undefined)throw new Error('Form setup requires input, submit, invalid-value and valid-value');
    config.form={input:options.input,submit:options.submit,invalidValue:options['invalid-value'],validValue:options['valid-value']};
    config.targetPaths[options.input]='index.html';
  }
  const temp=resolve(root,`.stylecon-init-${randomUUID()}.json`);
  await writeFile(temp,JSON.stringify(config),{flag:'wx',mode:0o600});
  try {
    const project=await loadProject(temp);const snapshot=await snapshotProject(project);
    const html=snapshot.files['index.html'];
    for(const id of [trigger,dialog,close,options.input,options.submit].filter(Boolean)) {
      const matches=[...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].filter(m=>m[1]===id.slice(1));
      if(matches.length!==1)throw new Error(`Expected one ${id} in index.html; choose a supported unique target`);
    }
    await writeFile(resolve(root,'project.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
    return {created:'project.json',files,journey:config.journey,next:'stylecon check <project-directory>',scope:'Static light-DOM button/dialog journey. IDs are source hints; check verifies actual browser targets.'};
  }finally{await unlink(temp);}
}

export async function initCommand(args,{input=process.stdin,output=process.stdout}={}) {
  const [directory,...flags]=args;if(!directory)throw new Error('Usage: stylecon init <project-directory> [options]');
  const options={};let yes=false;
  const keys=['files','trigger','dialog','close','name','input','submit','invalid-value','valid-value','constitution'];
  for(let i=0;i<flags.length;i++) {
    if(flags[i]==='--yes'){yes=true;continue;}
    const key=flags[i].slice(2);
    if(!flags[i].startsWith('--')||!keys.includes(key)||options[key]!==undefined||flags[i+1]===undefined)throw new Error('Unknown, duplicate or incomplete init option');
    options[key]=flags[++i];
  }
  if(!yes) {
    if(!input.isTTY)throw new Error('Interactive setup needs a terminal; provide explicit options and --yes for automation');
    const rl=createInterface({input,output});
    try{
      const root=await realpath(directory);
      output.write('Configure one static page. Setup reads files and writes project.json; it does not execute your page.\n');
      output.write(`Root entries: ${(await readdir(root)).slice(0,25).join(', ')}\n`);
      for(const [key,label,fallback] of [['files','Allowed files, comma-separated','index.html'],['trigger','Button that opens the dialog (#id)',''],['dialog','Dialog (#id)',''],['close','Button that closes it (#id)',''],['name','Visible dialog title','']])if(options[key]===undefined)options[key]=(await rl.question(`${label}${fallback?` [${fallback}]`:''}: `)).trim()||fallback;
      if(options.constitution===undefined)options.constitution=(await rl.question('Pinned constitution JSON inside this project (empty = bundled rules): ')).trim();
      if((await rl.question('Does a form need valid input before opening? [y/N]: ')).trim().toLowerCase()==='y')for(const [key,label] of [['input','Input (#id)'],['submit','Submit button (#id)'],['invalid-value','Synthetic invalid value (empty allowed)'],['valid-value','Synthetic valid value']])options[key]=await rl.question(`${label}: `);
      output.write(JSON.stringify(options,null,2)+'\n');
      if((await rl.question('Save this scope as a new project.json? [y/N]: ')).trim().toLowerCase()!=='y')return {created:false,reason:'Setup cancelled'};
    }finally{rl.close();}
  }
  return initProject(resolve(directory),options);
}
