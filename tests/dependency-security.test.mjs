import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {ESLint} from 'eslint';

const require=createRequire(import.meta.url);
const mcpRequire=createRequire(require.resolve('@modelcontextprotocol/node'));
const {Hono}=mcpRequire('hono');
const {serveStatic}=mcpRequire('@hono/node-server/serve-static');
const eslintRequire=createRequire(require.resolve('eslint'));
const {Minimatch}=eslintRequire('minimatch');

test('MCP-resolved static adapter refuses second decoding while public files still work',async()=>{
  const root=await mkdtemp(join(tmpdir(),'stylecon-static-security-'));
  try{
    await mkdir(join(root,'admin'));
    await writeFile(join(root,'admin','private.txt'),'synthetic restricted content');
    await writeFile(join(root,'public.txt'),'synthetic public content');
    const makeApp=allowPercentInPath=>{
      const app=new Hono();
      app.use('/admin/*',c=>c.text('unauthorized',401));
      app.use('*',serveStatic({root,allowPercentInPath}));
      return app;
    };
    const app=makeApp(undefined);
    assert.equal((await app.request('/admin/private.txt')).status,401);
    const publicResponse=await app.request('/public.txt');
    assert.equal(publicResponse.status,200);
    assert.equal(await publicResponse.text(),'synthetic public content');
    // Explicit opt-in restores legacy behavior: confirm this fixture actually
    // reaches the decoding gap, rather than passing on an unrelated 404.
    const encoded='/%%36%31dmin/private.txt';
    const legacy=await makeApp(true).request(encoded);
    assert.equal(legacy.status,200);
    assert.equal(await legacy.text(),'synthetic restricted content');
    assert.equal((await app.request(encoded)).status,404);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('ESLint-resolved minimatch bounds preprocessing and preserves ordinary matching',()=>{
  const pattern='a/'+Array.from({length:12},(_,i)=>`**/../p${i}`).join('/')+'/end';
  const matcher=new Minimatch(pattern,{optimizationLevel:2,braceExpandMax:16});
  assert.ok(matcher.globParts.length<=16,'preprocessing must respect the expansion budget');
  const ordinary=new Minimatch('tests/**/*.{js,mjs}',{optimizationLevel:2});
  assert.equal(ordinary.match('tests/nested/example.mjs'),true);
  assert.equal(ordinary.match('docs/example.md'),false);
});

test('upgraded ESLint still selects source files, rejects undefined names and respects ignores',async()=>{
  const eslint=new ESLint({cwd:resolve(import.meta.dirname,'..')});
  const clean=await eslint.lintText('console.log("fixture");\n',{filePath:'tests/dependency-probe.mjs'});
  assert.equal(clean[0].errorCount,0);
  const broken=await eslint.lintText('undeclaredSecurityProbe();\n',{filePath:'tests/dependency-probe.mjs'});
  assert.ok(broken[0].messages.some(message=>message.ruleId==='no-undef'));
  assert.equal(await eslint.isPathIgnored('dist/dependency-probe.mjs'),true);
  assert.equal(await eslint.isPathIgnored('tests/dependency-probe.mjs'),false);
});
