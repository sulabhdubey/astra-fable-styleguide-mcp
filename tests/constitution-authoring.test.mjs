import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, lstat, mkdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createConstitutionCandidate, exportConstitutionCandidate, getConstitutionAuthoringCatalog, importCssSuggestions} from '../scripts/constitution-authoring.mjs';
import {pinConstitution, loadPinnedConstitution} from '../scripts/constitution.mjs';

const root=resolve(import.meta.dirname,'..');

async function teamSource(temp) {
  const source=join(temp,'source');
  await cp(join(root,'spec'),join(source,'spec'),{recursive:true});
  return source;
}

test('CSS import produces bounded local-variable suggestions with provenance and never accepts them',()=>{
  const result=importCssSuggestions(':root { --color-blue-600: #1D4ED8; --space-4: 20px; --space-5: loose; --color-red-600: #ffffff !important; --unknown: url(https://example.test/a); }');
  assert.deepEqual(result.suggestions.map(item=>item.path),['tokens.color.blue.600.$value','tokens.space.4.$value']);
  assert.equal(result.suggestions[0].provenance.variable,'--color-blue-600');
  assert.equal(result.suggestions[0].accepted,false);
  assert.equal(result.unmapped.length,3);
  assert.match(result.unmapped[0].reason,/unsupported/i);
});

test('authoring catalog exposes only existing supported paths and current base identity',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'constitution-catalog-'));
  try {
    const source=await teamSource(temp);
    const catalog=await getConstitutionAuthoringCatalog(source);
    assert.match(catalog.baseSha256,/^[a-f0-9]{64}$/);
    assert.ok(catalog.tokenPaths.some(item=>item.path==='tokens.typography.fontSize.300.$value'&&item.value==='16px'));
    assert.ok(!catalog.tokenPaths.some(item=>item.path.includes('__proto__')));
    assert.deepEqual(catalog.buttonMinimumTarget,{path:'components.button.accessibility.minimumTarget',value:'40px'});
  } finally { await rm(temp,{recursive:true,force:true}); }
});

test('authored contracts have exact base/candidate bindings and export as two distinct validated constitutions',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'constitution-authoring-'));
  try {
    const source=await teamSource(temp);
    const a=await createConstitutionCandidate(source,{changes:[{path:'tokens.typography.fontSize.300.$value',value:'18px'}]});
    const b=await createConstitutionCandidate(source,{changes:[{path:'components.button.accessibility.minimumTarget',value:'48px'}],exceptions:[{rule:'STYLE-A11Y-009',target:'#legacy-button',reason:'Legacy embedded control requires human remediation review.'}]});
    assert.equal(a.baseSha256,b.baseSha256);
    assert.notEqual(a.candidateSha256,b.candidateSha256);
    assert.equal(a.beforeAfterDiff[0].before,'16px');
    assert.equal(b.beforeAfterDiff[0].after,'48px');
    assert.deepEqual(b.exceptions,[{rule:'STYLE-A11Y-009',target:'#legacy-button',reason:'Legacy embedded control requires human remediation review.'}]);

    const destinationA=join(temp,'constitution-a');
    const destinationB=join(temp,'constitution-b');
    const exportedA=await exportConstitutionCandidate(source,a,a.candidateSha256,destinationA);
    const exportedB=await exportConstitutionCandidate(source,b,b.candidateSha256,destinationB);
    assert.equal(exportedA.candidateSha256,a.candidateSha256);
    assert.equal(JSON.parse(await readFile(join(destinationB,'spec','components','button.json'),'utf8')).accessibility.minimumTarget,'48px');
    const review=JSON.parse(await readFile(join(destinationB,'constitution-review.json'),'utf8'));
    assert.equal(review.candidateSha256,b.candidateSha256);
    assert.deepEqual(review.exceptions,b.exceptions);
    assert.equal(review.reviewRecord.status,'pending-human-review');
    const pinA=await pinConstitution(destinationA,join(temp,'a.json'));
    const pinB=await pinConstitution(destinationB,join(temp,'b.json'));
    assert.notEqual(pinA.sha256,pinB.sha256);
    assert.equal((await loadPinnedConstitution(temp,{path:'b.json',sha256:pinB.sha256})).contract.minimumTarget,48);
    assert.equal((await lstat(join(source,'spec','components','button.json'))).isFile(),true);
  } finally { await rm(temp,{recursive:true,force:true}); }
});

test('authoring rejects unsafe or invalid edits, stale/tampered candidates, existing destinations, and symlink paths',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'constitution-authoring-refusal-'));
  try {
    const source=await teamSource(temp);
    await assert.rejects(createConstitutionCandidate(source,{changes:[{path:'tokens.__proto__.polluted.$value',value:'#ffffff'}]}),/unsafe|allowlisted/i);
    await assert.rejects(createConstitutionCandidate(source,{changes:[{path:'components.button.accessibility.focusVisible',value:false}]}),/unsupported|allowlisted/i);
    await assert.rejects(createConstitutionCandidate(source,{changes:[{path:'tokens.semantic.action.primary.foreground.$value',value:'#777777'}]}),/contrast|invalid/i);
    await assert.rejects(createConstitutionCandidate(source,{changes:[{path:'components.button.accessibility.minimumTarget',value:'24px'}]}),/invalid/i);
    await assert.rejects(createConstitutionCandidate(source,{changes:[{path:'tokens.space.4.$value',value:'20px'}],exceptions:[{rule:'STYLE-A11Y-009',target:'#x'}]}),/exception/i);

    const candidate=await createConstitutionCandidate(source,{changes:[{path:'tokens.space.4.$value',value:'20px'}]});
    await writeFile(join(source,'spec','tokens','layout.json'),(await readFile(join(source,'spec','tokens','layout.json'),'utf8')).replace('"640px"','"641px"'));
    await assert.rejects(exportConstitutionCandidate(source,candidate,candidate.candidateSha256,join(temp,'stale')),/stale/i);
    const fresh=await teamSource(join(temp,'fresh-root'));
    const valid=await createConstitutionCandidate(fresh,{changes:[{path:'tokens.space.4.$value',value:'20px'}]});
    await assert.rejects(exportConstitutionCandidate(fresh,{...valid,candidateSha256:'0'.repeat(64)},valid.candidateSha256,join(temp,'tampered')),/tampered|hash/i);
    const forged=JSON.parse(JSON.stringify(valid)); forged.files['components/button.json'].accessibility.minimumTarget='48px';
    const {createHash}=await import('node:crypto'); const {canonicalize}=await import('../dist/packages/style-spec/src/index.js');
    forged.candidateSha256=createHash('sha256').update(canonicalize({schemaVersion:forged.schemaVersion,baseSha256:forged.baseSha256,changes:forged.changes,exceptions:forged.exceptions,beforeAfterDiff:forged.beforeAfterDiff,files:forged.files,reviewRecord:forged.reviewRecord})).digest('hex');
    await assert.rejects(exportConstitutionCandidate(fresh,forged,forged.candidateSha256,join(temp,'forged')),/reconstruct|forged/i);
    const exists=join(temp,'exists'); await mkdir(exists);
    await assert.rejects(exportConstitutionCandidate(fresh,valid,valid.candidateSha256,exists),/exist/i);
    const linked=join(temp,'linked'); await symlink(join(temp,'outside'),linked,'junction');
    await assert.rejects(exportConstitutionCandidate(fresh,valid,valid.candidateSha256,linked),/symlink|exist/i);
    const rootLink=join(temp,'source-link'); await symlink(fresh,rootLink,'junction');
    await assert.rejects(createConstitutionCandidate(rootLink,{changes:[{path:'tokens.space.4.$value',value:'20px'}]}),/symlink/i);
  } finally { await rm(temp,{recursive:true,force:true}); }
});
