import {loadProject,snapshotProject} from './project-workflow.mjs';
import {loadRunningProject,snapshotRunningProject} from './running-app.mjs';
import {readJson} from './project-cli.mjs';
import {createHash} from 'node:crypto';
import {loadStorybookProject,validateStorySelection} from './storybook-check.mjs';

/** File freshness only. This never treats a stored observation as a new browser run. */
export async function assertCurrentReport(configPath,report) {
  if((await readJson(configPath)).schemaVersion===3) {
    const project=await loadStorybookProject(configPath);
    const selection=validateStorySelection(project.config,report?.browserScope?.selection);
    const configuration=createHash('sha256').update(JSON.stringify([project.configHash,selection])).digest('hex');
    if(report?.artifactSha256!==project.identity.before.sha256||report.specSha256!==project.contract.specSha256||report.projectConfigurationSha256!==configuration)throw new Error('Evidence is stale. Run checks again before preparing a brief.');
    return {project,artifactSha256:project.identity.before.sha256,specSha256:project.contract.specSha256};
  }
  const running=(await readJson(configPath)).schemaVersion===2;
  const project=running?await loadRunningProject(configPath):await loadProject(configPath);
  const snapshot=running?await snapshotRunningProject(project):await snapshotProject(project);
  const artifact=running?snapshot.sha256:snapshot.artifactSha256;
  const contract=running?project.contract:snapshot.contract;
  if(!report||report.artifactSha256!==artifact||report.specSha256!==contract.specSha256||report.projectConfigurationSha256!==project.configHash)throw new Error('Evidence is stale. Run checks again before preparing a brief.');
  return {project,artifactSha256:artifact,specSha256:contract.specSha256};
}
