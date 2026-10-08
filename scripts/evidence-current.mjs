import {loadProject,snapshotProject} from './project-workflow.mjs';
import {loadRunningProject,snapshotRunningProject} from './running-app.mjs';
import {readJson} from './project-cli.mjs';

/** File freshness only. This never treats a stored observation as a new browser run. */
export async function assertCurrentReport(configPath,report) {
  const running=(await readJson(configPath)).schemaVersion===2;
  const project=running?await loadRunningProject(configPath):await loadProject(configPath);
  const snapshot=running?await snapshotRunningProject(project):await snapshotProject(project);
  const artifact=running?snapshot.sha256:snapshot.artifactSha256;
  const contract=running?project.contract:snapshot.contract;
  if(!report||report.artifactSha256!==artifact||report.specSha256!==contract.specSha256||report.projectConfigurationSha256!==project.configHash)throw new Error('Evidence is stale. Run checks again before preparing a brief.');
  return {project,artifactSha256:artifact,specSha256:contract.specSha256};
}
