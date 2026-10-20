/* global structuredClone */
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepareDemo} from './prepare-demo.mjs';
import {runCheck} from './standalone-check.mjs';
import {compareCandidates} from './candidate-comparison.mjs';

// Real rendered fixtures, not model proposals: compare a correct target-size repair
// against the same repair with an introduced focus-restoration regression.
const root=await mkdtemp(join(tmpdir(),'stylecon-candidates-'));
const demo=await prepareDemo(join(root,'demo'));
const html=join(root,'demo/project/index.html'),original=await readFile(html,'utf8');
const change=JSON.parse(await readFile(demo.change,'utf8'));
const base=await runCheck(demo.project);
const repaired=original.replace(change.before,()=>change.after);
await writeFile(html,repaired);const a=await runCheck(demo.project);
const restore="dialog.addEventListener('close',()=>trigger.focus())";
assert.equal(repaired.split(restore).length,2);
await writeFile(html,repaired.replace(restore,"dialog.addEventListener('close',()=>input.focus())"));
const b=await runCheck(demo.project);
await writeFile(join(root,'rendered-inputs.json'),JSON.stringify({baseline:base.result,a:a.result,b:b.result},null,2));
const comparison=compareCandidates(base.result,a.result,b.result);
assert.equal(comparison.preference,'A',JSON.stringify(comparison));
assert.ok(comparison.candidates[1].regressed.some(check=>/focus/i.test(check.check)));
const files=[];
for(const [name,value]of [['baseline',base.result],['candidate-a',a.result],['candidate-b',b.result]]) {
  const path=join(root,name+'.json');await writeFile(path,JSON.stringify(value));files.push(path);
}
const command=resolve(process.argv[2]??'packages/cli/dist/stylecon.mjs');
const cli=spawnSync(process.execPath,[command,'candidates','compare',...files],{encoding:'utf8'});
assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),comparison);
// An unknown check cannot count as a repair, including through the installed CLI.
const incomplete=structuredClone(a.result),report=incomplete.report??incomplete;
report.checks[0].status='not_checked';report.status='not_checked';
await writeFile(files[1],JSON.stringify(incomplete));
const refused=spawnSync(process.execPath,[command,'candidates','compare',...files],{encoding:'utf8'});
assert.equal(refused.status,2,refused.stderr);assert.equal(JSON.parse(refused.stdout).preference,null);
const receipt={passed:true,scope:'Synthetic rendered target-size and focus-restoration cases; no model or general collaboration benefit claim',
  privateEvidence:root,comparison,cliIncompleteRefusal:true};
await writeFile(join(root,'candidate-verification.json'),JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt));
