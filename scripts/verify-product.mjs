import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

// Serve the built site on loopback by default; never expose repository sources.
const root = resolve('apps/docs/dist');
const prefix = `/${(process.env.BASE_PATH || '').replace(/^\/+|\/+$/g, '')}`.replace(/\/$/, '');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };
const server = process.env.PRODUCT_PREVIEW_URL ? null : createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(`${prefix}/`)) { response.writeHead(404).end(); return; }
    const suffix = pathname.slice(prefix.length).replace(/^\/+/, '');
    const file = resolve(root, suffix.endsWith('/') || !suffix ? `${suffix}index.html` : suffix);
    if (!file.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' }).end(body);
  } catch { response.writeHead(404).end(); }
});
if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = process.env.PRODUCT_PREVIEW_URL || `http://127.0.0.1:${server.address().port}${prefix}/`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => globalThis.document.activeElement.textContent), 'Skip to content');
  await page.getByRole('link', { name: 'Try the interactive demo', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, new URL('demo/', base).pathname);
  const check = page.getByRole('button', { name: 'Check button', exact: true });
  const apply = page.getByRole('button', { name: 'Apply correction', exact: true });
  const result = page.locator('#measurement');
  assert.equal(await apply.isEnabled(), false);
  await check.click();
  assert.match(await result.innerText(), /24.*below/);
  await page.getByRole('button', { name: 'Review correction', exact: true }).click();
  await apply.click();
  assert.match(await result.innerText(), /Recheck/);
  await check.click();
  assert.match(await result.innerText(), /meets/);
  await page.getByRole('button', { name: 'Undo correction', exact: true }).click();
  assert.match(await result.innerText(), /Check/);
  assert.equal(await apply.isEnabled(), false);
  await check.click();
  assert.match(await result.innerText(), /24.*below/);

  await page.goto(new URL('start/', base).href);
  await page.getByLabel('Your coding client').selectOption('cursor');
  assert.match(await page.locator('#configuration').innerText(), /mcpServers/);
  await page.getByLabel('Your coding client').selectOption('other');
  assert.equal((await page.locator('#configuration').innerText()).trim(), 'https://astra-fable-styleguide-mcp.vercel.app/mcp');
  await page.evaluate(() => Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async () => { throw new Error('blocked'); } }, configurable: true }));
  await page.getByRole('button', { name: 'Copy configuration', exact: true }).click();
  await page.getByText('Copy unavailable. Select the configuration above and copy it manually.', { exact: true }).waitFor();

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    for (const route of ['', 'demo/', 'start/', 'feedback/', 'components/']) {
      const response = await page.goto(new URL(route, base).href);
      assert.equal(response.status(), 200, route);
      const internalLinks = await page.locator('a[href]').evaluateAll(links => links.map(link => link.href).filter(href => href.startsWith(globalThis.location.origin) && !href.includes('#')));
      for (const href of new Set(internalLinks)) {
        const linked = await page.request.get(href);
        assert.equal(linked.status(), 200, `broken link: ${href}`);
      }
      assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, `overflow: ${route} ${width}`);
      if (process.env.PRODUCT_EVIDENCE_DIR && ['','demo/','start/'].includes(route)) {
        await mkdir(process.env.PRODUCT_EVIDENCE_DIR, { recursive: true });
        await page.screenshot({ path: resolve(process.env.PRODUCT_EVIDENCE_DIR, `${route.replace('/','') || 'home'}-${width}.png`), fullPage: true });
      }
    }
  }
  await page.goto(new URL('feedback/', base).href);
  await page.locator('#feedback').fill('The first confusing step: setup');
  await page.evaluate(() => Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async text => { globalThis.__copied = text; } }, configurable: true }));
  await page.getByRole('button', { name: 'Copy report', exact: true }).click();
  await page.getByText('Copied. Nothing has been sent.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.__copied), 'The first confusing step: setup');
  const noScript = await browser.newContext({ javaScriptEnabled: false });
  const fallback = await noScript.newPage();
  await fallback.goto(new URL('demo/', base).href);
  assert.match(await fallback.locator('noscript').innerText(), /JavaScript/);
  await noScript.close();
  assert.deepEqual(errors, []);
  console.log('Product browser checks passed: lifecycle, setup fallback, mobile, reference, no-JS.');
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
