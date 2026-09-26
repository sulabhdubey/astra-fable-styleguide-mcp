import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const paths=[
  'generated/css/tokens.css',
  'generated/json/tokens.json',
  'generated/json/style-spec.json',
  'generated/typescript/tokens.ts',
  'architecture.png'
];
const hashes={};
for(const path of paths){
  const data=await readFile(path);
  hashes[path]=createHash('sha256').update(data).digest('hex');
}
const manifest=JSON.parse(await readFile('spec/manifest.json','utf8'));
const requestedConnected=process.env.RELEASE_EVIDENCE_CONNECTED==='1';
const connected=requestedConnected && process.env.GITHUB_ACTIONS==='true' && process.env.GITHUB_WORKFLOW==='Release Gate' && process.env.GITHUB_EVENT_NAME==='workflow_dispatch' && /^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA??'') && /^\d+$/.test(process.env.GITHUB_RUN_ID??'');
if(requestedConnected&&!connected)throw new Error('Connected release evidence requires a GitHub Actions commit and run ID');
const gateStatus=connected?'pass':'not_recorded';
const evidence={
  version:manifest.version,
  status:manifest.status,
  verification:{
    scope:connected?'github-release-gate':'hashes-only',
    frozenInstall:gateStatus,
    structuralLint:gateStatus,
    eslint:gateStatus,
    typecheck:gateStatus,
    fullTypecheck:gateStatus,
    tests:gateStatus,
    canonicalValidation:gateStatus,
    build:gateStatus,
    productBrowser:gateStatus,
    dialogBoundaryBrowser:gateStatus,
    generatedReproducibility:gateStatus,
    generatedDiff:gateStatus,
    mcpSmoke:gateStatus,
    sourceAndDependencyAudit:gateStatus,
    dockerBuild:gateStatus
  },
  ...(connected?{connectedProof:{
    environment:'github-actions',
    commit:process.env.GITHUB_SHA??null,
    runId:process.env.GITHUB_RUN_ID??null
  }}:{}),
  sha256:hashes
};
const output=process.env.RELEASE_EVIDENCE_OUTPUT??`releases/${manifest.version}-build-evidence.json`;
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
