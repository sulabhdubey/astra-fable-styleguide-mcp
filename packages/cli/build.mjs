import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=resolve(root,'packages/cli/dist');
await mkdir(output,{recursive:true});
await build({entryPoints:[resolve(root,'packages/cli/src/bin.ts')],bundle:true,platform:'node',target:'node22',format:'esm',outfile:resolve(output,'validate.mjs')});
await copyFile(resolve(root,'packages/cli/src/entry.mjs'),resolve(output,'stylecon.mjs'));
const files=['scripts/project-workflow.mjs','scripts/project-cli.mjs','scripts/standalone-check.mjs','scripts/verify-project.mjs','scripts/browser-journey.mjs','scripts/product-observations.mjs','scripts/prepare-demo.mjs','packages/browser-verification/src/index.mjs','packages/browser-verification/src/product-checks.mjs','generated/css/tokens.css','spec/components/button.json','spec/components/dialog.json','spec/accessibility/rules.json','examples/profile/index.html','examples/profile/project.json'];
for(const path of files){const destination=resolve(output,'runtime',path);await mkdir(dirname(destination),{recursive:true});await copyFile(resolve(root,path),destination);}
