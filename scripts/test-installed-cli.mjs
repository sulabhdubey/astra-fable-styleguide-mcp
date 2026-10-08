import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const cli=resolve(process.argv[2]??'packages/cli/dist/stylecon.mjs');
const root=await mkdtemp(join(tmpdir(),'stylecon-install-proof-'));
const run=(args,expected=0)=>{
  const result=spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',timeout:60000});
  assert.equal(result.status,expected,`${args[0]}: ${result.stderr||result.error||result.stdout}`);
  return result.stdout;
};
run(['doctor']);
const demo=JSON.parse(run(['demo',join(root,'demo')]));
const before=join(demo.evidence,'before.json'),packet=join(demo.evidence,'packet.json');
run(['check',demo.project,'--format','json','--output',before],1);
const failed=JSON.parse(await readFile(before,'utf8'));
assert.equal(failed.report.checks.filter(c=>c.status==='fail').length,1);
assert.equal(failed.report.checks.find(c=>c.target==='#review'&&c.check==='target').observed.height,24);
const selections=JSON.parse(run(['brief',demo.project,before,'--list']));assert.equal(selections.length,1);
const briefPath=join(demo.evidence,'agent-brief.txt');
run(['brief',demo.project,before,'--select',selections[0].id,'--output',briefPath]);
const brief=await readFile(briefPath,'utf8');assert.match(brief,/artifactSha256/);assert.match(brief,/projectConfigurationSha256/);assert.doesNotMatch(brief,/<!doctype|receiptPath/);
run(['brief',demo.project,before,'--select',selections[0].id,'--output',briefPath],2);
const reviewJson=join(demo.evidence,'review.json'),reviewHtml=join(demo.evidence,'review.html');
run(['review','create',demo.project,before,reviewJson]);run(['review','create',demo.project,before,reviewHtml]);
const review=JSON.parse(await readFile(reviewJson,'utf8'));
assert.equal(review.scope.total,failed.report.checks.length);assert.equal(review.counts.fail,1);
assert.match(run(['review','verify',reviewJson]),/not author authentication/);
assert.doesNotMatch(await readFile(reviewHtml,'utf8'),/#review|index.html|Studio member/);
run(['review','create',demo.project,before,reviewJson],2);
run(['review','create',demo.project,before,join(root,'demo/project/should-not-write.html')],2);
const altered=join(demo.evidence,'altered-review.json');await writeFile(altered,JSON.stringify({...review,status:'pass'}));run(['review','verify',altered],2);
run(['packet',demo.project,before,packet]);
run(['repair','preview',demo.project,packet,demo.change]);
const applied=JSON.parse(run(['repair','apply',demo.project,packet,demo.change,demo.evidence]));
const passed=JSON.parse(run(['check',demo.project,'--format','json']));
assert.equal(passed.report.status,'pass');
run(['brief',demo.project,before,'--select',selections[0].id],2);
run(['review','create',demo.project,before,join(demo.evidence,'stale-review.html')],2);
run(['repair','preview',demo.project,packet,demo.change],2);
run(['repair','undo',demo.project,applied.receiptPath,demo.evidence]);
run(['check',demo.project],1);
const htmlPath=join(root,'demo/project/index.html');
let fixed=await readFile(htmlPath,'utf8');const change=JSON.parse(await readFile(demo.change,'utf8'));
fixed=fixed.replace(change.before,()=>change.after);
const input=/<input id="display-name"[^>]+>/;
assert.match(fixed,input);
for(const [kind,control] of [
  ['textarea','<textarea id="display-name" aria-describedby="name-error">Studio member</textarea>'],
  ['select','<select id="display-name" aria-describedby="name-error"><option value="">Choose</option><option value="Studio member" selected>Studio member</option></select>']
]) {
  await writeFile(htmlPath,fixed.replace(input,()=>control));
  const result=JSON.parse(run(['check',demo.project,'--format','json']));
  assert.equal(result.report.status,'pass',kind);
  await writeFile(htmlPath,fixed.replace(input,()=>control).replace('aria-describedby="name-error"',''));
  const broken=JSON.parse(run(['check',demo.project,'--format','json'],1));
  assert.ok(broken.report.checks.some(c=>c.check==='error-association'&&c.status==='fail'),kind);
}
await writeFile(htmlPath,fixed.replace('</script>','throw new Error("fixture failure");</script>'));
run(['check',demo.project,'--format','json'],2);
console.log(JSON.stringify({installedCli:cli,privateEvidence:root,passed:true,cases:['broken target','repair','recheck','stale packet','undo','textarea valid and broken association','select valid and broken association','page error incomplete']}));
