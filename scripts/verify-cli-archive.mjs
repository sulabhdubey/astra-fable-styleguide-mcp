import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,cp,rm} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

/** Install the actual checksum-bound artifact; never repack the CLI under test. */
export async function verifyCliArchive(directory,{browser=false}={}) {
  const root=resolve(import.meta.dirname,'..');
  const evidence=JSON.parse(await readFile(join(directory,'package-evidence.json'),'utf8'));
  const {filename,sha256}=evidence.archive;
  assert.equal(basename(filename),filename,'Archive filename must be local');
  assert.match(sha256,/^[a-f0-9]{64}$/);
  const archive=resolve(directory,filename);
  assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'),sha256,'Archive checksum changed');
  assert.equal((await readFile(join(directory,'SHA256SUMS'),'utf8')).trim(),`${sha256}  ${filename}`);
  const consumer=await mkdtemp(join(tmpdir(),'stylecon-exact-archive-'));
  const npm=resolve(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='npm_config_package')),npm_config_cache:join(consumer,'.npm-cache')};
  const run=(command,args,expected=0)=>{
    const result=spawnSync(command,args,{cwd:consumer,env,encoding:'utf8',timeout:240000});
    assert.equal(result.status,expected,result.stderr||result.error?.message||result.stdout);return result.stdout;
  };
  const runNpm=args=>run(process.platform==='win32'?process.execPath:'npm',process.platform==='win32'?[npm,...args]:args);
  try {
    // Seed only locked runtime dependencies; the CLI itself is the supplied artifact.
    const require=createRequire(import.meta.url),playwright=require.resolve('playwright/package.json');
    const archives=[];
    for(const manifest of [playwright,createRequire(playwright).resolve('playwright-core/package.json')]) {
      const packed=JSON.parse(runNpm(['pack','--ignore-scripts',dirname(manifest),'--pack-destination',consumer,'--json']))[0];
      archives.push(join(consumer,packed.filename));
    }
    runNpm(['install','--offline','--ignore-scripts','--omit=optional',...archives,archive]);
    const command=join(consumer,'node_modules/@styleconstitution/cli/dist/stylecon.mjs');
    const cli=(args,code=0)=>run(process.execPath,[command,...args],code);
    assert.match(cli(['--help']),/stylecon init/);
    await cp(join(root,'spec'),join(consumer,'canonical/spec'),{recursive:true});
    assert.match(cli(['validate','--root',join(consumer,'canonical')]),/StyleSpec valid/);
    const project=join(consumer,'project');await cp(join(root,'examples/profile'),project,{recursive:true});
    await rm(join(project,'project.json'));
    cli(['constitution','pin',join(consumer,'canonical'),join(project,'constitution.json')]);
    cli(['init',project,'--files','index.html','--trigger','#review','--dialog','#review-dialog','--close','#back','--name','Confirm display name','--input','#display-name','--submit','#review','--invalid-value','','--valid-value','Studio member','--constitution','constitution.json','--yes']);
    if(browser) {
      cli(['doctor']);
      const before=join(consumer,'report.json');
      cli(['check',project,'--format','json','--output',before]);
      const report=join(consumer,'report.html');
      cli(['report',project,'--format','html','--compare',before,'--output',report]);
      assert.match(await readFile(report,'utf8'),/0 findings resolved/);
      run(process.execPath,[join(root,'scripts/test-installed-cli.mjs'),command]);
    }
    const receipt={schemaVersion:1,archive:{filename,sha256},source:evidence.source,cleanConsumer:true,offlineInstall:true,checks:['help','validate','constitution pin','init',...(browser?['doctor','browser check','HTML report comparison','repair recheck stale refusal undo']:[])],browserVerified:browser,published:false};
    await writeFile(join(directory,'archive-verification.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
    return receipt;
  } finally {await rm(consumer,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2]||process.argv.length>4||(process.argv[3]&&process.argv[3]!=='--browser'))throw new Error('Usage: verify-cli-archive.mjs <package-directory> [--browser]');
  console.log(JSON.stringify(await verifyCliArchive(resolve(process.argv[2]),{browser:process.argv[3]==='--browser'})));
}
