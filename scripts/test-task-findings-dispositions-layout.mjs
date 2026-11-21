// Focused real-Chromium geometry on the actual mounted TaskFindings section (portal#1643) and production CSS.
// The fetch, form and navigation adapters are inert stand-ins: this does not prove authenticated routing,
// a mutation or the server's authority; independent QA on a private stack owns those.
// HADRON_LAYOUT_SHOTS=<dir> also writes the light/dark, phone/desktop screenshots.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright';

const fixture = `
import '/src/app.css';
import { mount, unmount, tick } from 'svelte';
import TaskFindings from '/src/lib/components/agent-tasks/TaskFindings.svelte';
let component;
const findings = [
  { id: 'F1', severity: 'P1', text: 'The pager accepted a repeated page as new rows. ' + 'It loops without ever reporting done. '.repeat(3) },
  { id: 'F2', severity: 'P2', text: 'A short finding.' },
  { id: 'F3', severity: 'P3', text: 'Right-to-left mark \\u202e hidden \\u202c and a very_long_unbroken_token_' + 'x'.repeat(90) },
  { id: 'F4', severity: 'note', text: 'Rejected by the owner.' },
  { id: 'F5', severity: 'P2', text: 'Not decided yet.' },
];
const set = (fail) => fail ? { kind: 'failed' } : { kind: 'ok', total: 4, items: [
  { findingId: 'F1', disposition: 'fixed', reference: { kind: 'PULL_REQUEST', target: 'https://github.com/hadron-memory/hadron-portal/pull/1772', label: 'the fix' } },
  { findingId: 'F2', disposition: 'accepted', reference: null },
  { findingId: 'F3', disposition: 'deferred', reference: { kind: 'ISSUE', target: 'https://github.com/hadron-memory/hadron-portal/issues/2111', label: null } },
  { findingId: 'F4', disposition: 'rejected', reference: null },
] };
window.scenario = async ({ canWrite = true, fail = false } = {}) => {
  if (component) await unmount(component);
  localStorage.clear();
  window.fetch = async (url) => String(url).endsWith('/dispositions')
    ? new Response(JSON.stringify(set(fail)), { status: 200, headers: { 'content-type': 'application/json' } })
    : new Response('{}', { status: 500 });
  component = mount(TaskFindings, { target: document.querySelector('main'), props: {
    appId: 'app', appUrn: 'hrn:app:acme.com:team', taskId: 'task', canWrite,
    initial: { kind: 'page', page: { taskId: 'task', offset: 0, items: findings, total: 5, hasMore: false } },
  } });
  await tick();
  // Ready when the separate dispositions read has answered (no cell still says Loading…), not after a guessed delay.
  const start = performance.now();
  while (performance.now() - start < 5000) {
    const cells = [...document.querySelectorAll('[data-testid=finding-disposition]')];
    if (cells.length && cells.every(c => !c.textContent.includes('Loading'))) return;
    await new Promise(r => requestAnimationFrame(r));
  }
  throw new Error('dispositions never settled');
};
await window.scenario();
window.fixtureReady = true;
`;
const aliases = Object.fromEntries(['navigation', 'environment', 'stores', 'state', 'forms'].map(name => [`$app/${name}`, resolve(`src/lib/test/stubs/app-${name}.ts`)]));
const server = await createServer({
  configFile: false, plugins: [tailwindcss(), svelte(), {
    name: 'findings-dispositions-fixture',
    resolveId(id) { if (id === '/__findings-entry.ts') return '\0findings-entry'; },
    load(id) { if (id === '\0findings-entry') return fixture; },
    configureServer(s) { s.middlewares.use('/__findings', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await s.transformIndexHtml('/__findings', '<html><body class="bg-white dark:bg-zinc-950"><main class="text-zinc-900 dark:text-zinc-100" style="margin:16px;min-width:0"></main><script type="module" src="/__findings-entry.ts"></script></body></html>'));
    }); },
  }], resolve: { alias: { $lib: resolve('src/lib'), ...aliases, '$env/dynamic/public': resolve('src/lib/test/stubs/env-dynamic-public.ts') } },
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(new URL('/__findings', server.resolvedUrls.local[0]).href);
  await page.waitForFunction(() => window.fixtureReady);
  const shot = async (name, width, dark) => {
    if (!process.env.HADRON_LAYOUT_SHOTS) return;
    await mkdir(process.env.HADRON_LAYOUT_SHOTS, { recursive: true });
    await page.screenshot({ path: resolve(process.env.HADRON_LAYOUT_SHOTS, `findings-${name}-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
  };
  for (const width of [390, 1280]) for (const dark of [false, true]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(async dark => { document.documentElement.classList.toggle('dark', dark); await window.scenario(); }, dark);
    const ctx = `${width}px ${dark ? 'dark' : 'light'}`;
    assert.equal(await page.locator('[data-testid=finding-disposition]').count(), 5, `five disposition cells (${ctx})`);
    const text = await page.locator('[data-testid=finding-disposition]').allTextContents();
    assert.ok(text[0].includes('Pull request:'), `reference kind is separated from its label (${ctx}): ${text[0]}`);
    assert.ok(text[0].includes('Fixed') && text[1].includes('Accepted') && text[2].includes('Deferred') && text[3].includes('Rejected') && text[4].includes('Not yet'), `all four codes and Not yet (${ctx}): ${text}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `document overflow (${ctx})`);
    // The write control is the first column: on screen without scrolling the table.
    const first = page.getByRole('button', { name: 'Record a disposition for finding F5', exact: true });
    await first.waitFor();
    const box = await first.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.height >= 24, `Record on screen at scroll 0 (${ctx}): ${JSON.stringify(box)}`);
    assert.equal(await page.getByRole('button', { name: 'Change the disposition of finding F1', exact: true }).count(), 1);
    await shot('list', width, dark);

    await first.click();
    const form = page.locator('[data-testid=disposition-form]');
    await form.waitFor();
    assert.equal(await form.locator('input[name=disposition]').count(), 4);
    assert.ok(await form.evaluate(el => document.activeElement && el.contains(document.activeElement)), `focus lands in the form (${ctx})`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `document overflow with the form (${ctx})`);
    for (const b of await form.locator('button').all()) {
      const r = await b.boundingBox();
      if (r) assert.ok(r.x >= 0 && r.x + r.width <= width, `form button on screen (${ctx}): ${JSON.stringify(r)}`);
    }
    // portal#2121: the finding's own text sits under the question, on screen, so it is not scrolled away at 390px.
    const quoted = form.locator('[data-testid=disposition-finding-text]');
    assert.equal((await quoted.textContent()).trim(), 'Not decided yet.', `finding text repeated in the form (${ctx})`);
    const q = await quoted.boundingBox();
    assert.ok(q && q.x >= 0 && q.x + q.width <= width && q.y >= 0 && q.y < 1100, `finding text on screen (${ctx}): ${JSON.stringify(q)}`);
    await shot('form', width, dark);
    await page.keyboard.press('Tab');
    assert.ok(await form.evaluate(el => el.contains(document.activeElement)), `Tab stays inside the form (${ctx})`);
  }
  await page.setViewportSize({ width: 390, height: 1100 });
  await page.evaluate(async () => { document.documentElement.classList.remove('dark'); await window.scenario({ fail: true }); });
  assert.equal((await page.locator('[data-testid=finding-disposition]').allTextContents()).every(t => t.trim() === 'Unknown'), true, 'a failed read is Unknown, never Not yet');
  assert.equal(await page.locator('[data-testid=dispositions-failed]').count(), 1);
  await shot('failed', 390, false);
  await page.evaluate(async () => window.scenario({ canWrite: false }));
  assert.equal(await page.locator('[data-testid=finding-dispose]').count(), 0, 'no write control without write');
  assert.deepEqual(errors, [], 'page errors');
  console.log('PASS: actual mounted Findings section at 390/1280, light/dark: all four codes, Record/Change on screen at scroll 0, the form, focus, the failed read and the read-only reader; no authenticated write claim.');
} finally { await browser?.close(); await server.close(); }
