import {readFile,readdir,realpath,writeFile,rename} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {cliInputFingerprint,cliOutputFingerprint} from './cli-inputs.mjs';

const root=resolve(import.meta.dirname,'..');
const directory=await realpath(process.argv[2]??'');
const development=process.argv[3]==='--development';
if(!process.argv[2]||process.argv.length>4||(process.argv[3]&&!development))throw new Error('Usage: package-cli.mjs <new-empty-output-directory> [--development]');
const rel=relative(root,directory);if(!isAbsolute(rel)&&!rel.startsWith('..'))throw new Error('Keep release artifacts outside the source checkout');
if((await readdir(directory)).length)throw new Error('Package output directory must be empty');
const run=(command,args,cwd=root)=>{
  const result=spawnSync(command,args,{cwd,encoding:'utf8',env:{...process.env,npm_config_cache:resolve(directory,'.npm-cache')}});
  if(result.status!==0)throw new Error(result.stderr||result.error?.message||'Packaging command failed');return result.stdout.trim();
};
const git=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});
// Docker source contexts deliberately omit .git. Development artifacts still
// bind exact file content, and must disclose the unavailable commit provenance.
const unavailable=git.error?.code==='ENOENT'||(git.status===128&&/not a git repository/i.test(git.stderr));
if(git.status!==0&&!unavailable)throw new Error(git.stderr||git.error?.message||'Cannot inspect source identity');
if(unavailable&&!development)throw new Error('Release packaging requires Git commit provenance');
const commit=unavailable?null:git.stdout.trim(),dirty=unavailable?null:Boolean(run('git',['status','--porcelain']));
if(dirty&&!development)throw new Error('Release packaging requires a clean exact source commit');
const input=await cliInputFingerprint(root);
const built=JSON.parse(await readFile(resolve(root,'packages/cli/dist/build-input.json'),'utf8'));
if(built.sha256!==input.sha256)throw new Error('CLI inputs changed since build; compile and build the CLI again before packaging');
const output=await cliOutputFingerprint(resolve(root,'packages/cli/dist'));
if(built.output?.sha256!==output.sha256)throw new Error('Built CLI files changed; build the CLI again before packaging');
const packageJson=JSON.parse(await readFile(resolve(root,'packages/cli/package.json'),'utf8'));
const manifest=JSON.parse(await readFile(resolve(root,'spec/manifest.json'),'utf8'));
if(!development&&packageJson.version!==manifest.version)throw new Error('CLI and canonical release versions must match');
const npm=resolve(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const packed=JSON.parse(run(process.platform==='win32'?process.execPath:'npm',process.platform==='win32'?[npm,'pack','--ignore-scripts',resolve(root,'packages/cli'),'--pack-destination',directory,'--json']:['pack','--ignore-scripts',resolve(root,'packages/cli'),'--pack-destination',directory,'--json'],directory))[0];
if(packed.files.some(file=>!file.path.startsWith('dist/')&&file.path!=='package.json'))throw new Error('Unexpected file in CLI archive');
const filename=development?`styleconstitution-cli-${packageJson.version}-dev-${input.sha256.slice(0,12)}.tgz`:packed.filename;
if(filename!==packed.filename)await rename(resolve(directory,packed.filename),resolve(directory,filename));
const bytes=await readFile(resolve(directory,filename));const sha256=createHash('sha256').update(bytes).digest('hex');
const evidence={schemaVersion:1,channel:development?'development':'release-candidate',releaseAuthorized:false,cliVersion:packageJson.version,constitutionVersion:manifest.version,source:{commit,dirty,gitAvailable:!unavailable,inputSha256:input.sha256,inputFiles:input.files},archive:{filename,sha256,bytes:bytes.length},files:packed.files.map(file=>file.path)};
await writeFile(resolve(directory,'package-evidence.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
await writeFile(resolve(directory,'SHA256SUMS'),`${sha256}  ${filename}\n`,{flag:'wx'});
console.log(JSON.stringify({archive:filename,sha256,channel:evidence.channel,releaseAuthorized:false}));
