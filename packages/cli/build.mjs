import {build} from 'esbuild';
import {mkdir,copyFile,writeFile,rm,cp} from 'node:fs/promises';
import {cliInputFingerprint,cliOutputFingerprint} from '../../scripts/cli-inputs.mjs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=resolve(root,'packages/cli/dist');
// This fixed build-owned directory is recreated so obsolete runtime files cannot ship.
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await build({entryPoints:[resolve(root,'packages/cli/src/bin.ts')],bundle:true,platform:'node',target:'node22',format:'esm',outfile:resolve(output,'validate.mjs')});
await copyFile(resolve(root,'packages/cli/src/entry.mjs'),resolve(output,'stylecon.mjs'));
const files=['scripts/project-workflow.mjs','scripts/project-cli.mjs','scripts/standalone-check.mjs','scripts/verify-project.mjs','scripts/browser-journey.mjs','scripts/product-observations.mjs','scripts/prepare-demo.mjs','packages/browser-verification/src/index.mjs','packages/browser-verification/src/product-checks.mjs','generated/css/tokens.css','spec/components/button.json','spec/components/dialog.json','spec/accessibility/rules.json','examples/profile/index.html','examples/profile/project.json'];
files.push('scripts/project-init.mjs','scripts/html-report.mjs','spec/manifest.json');
files.push('scripts/studio.mjs','scripts/running-app.mjs','scripts/design-observations.mjs','scripts/ci-report.mjs','generated/json/tokens.json','packages/cli/studio/index.html','packages/cli/studio/app.mjs','packages/cli/studio/style.css');
files.push('scripts/running-repair.mjs','scripts/running-repair-map.mjs');
files.push('scripts/running-setup.mjs','scripts/report-coverage.mjs');
for(const path of files){const destination=resolve(output,'runtime',path);await mkdir(dirname(destination),{recursive:true});await copyFile(resolve(root,path),destination);}
await cp(resolve(root,'spec'),resolve(output,'runtime/spec'),{recursive:true});
await build({entryPoints:[resolve(root,'scripts/constitution.mjs')],bundle:true,platform:'node',target:'node22',format:'esm',outfile:resolve(output,'runtime/scripts/constitution.mjs')});
await build({entryPoints:[resolve(root,'scripts/constitution-authoring.mjs')],bundle:true,platform:'node',target:'node22',format:'esm',outfile:resolve(output,'runtime/scripts/constitution-authoring.mjs')});
await build({entryPoints:[resolve(root,'scripts/running-app.mjs')],bundle:true,platform:'node',target:'node22',format:'esm',external:['playwright'],outfile:resolve(output,'runtime/scripts/running-app.mjs')});
await writeFile(resolve(output,'build-input.json'),JSON.stringify({...await cliInputFingerprint(root),output:await cliOutputFingerprint(output)})+'\n');
