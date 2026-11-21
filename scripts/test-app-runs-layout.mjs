// Controlled component fixture only; private signed-in route/provider evidence belongs to QA.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'runs-navigation-stub', enforce: 'pre', transform(code, id) {
 if (/AppRunsPanel\.svelte$/.test(id)) return code.replace("from '$app/stores'", "from '$lib/test/stubs/app-stores'");
 return /AppRunsTable\.svelte$/.test(id) ? code.replace("from '$app/navigation'", "from '$lib/test/stubs/app-navigation'") : null;
} }] });
let browser;
try {
 await server.listen(); const origin = server.resolvedUrls.local[0];
 const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
 const runForm = await superValidate(zod4(z.object({ _kind: z.literal('runFlow').default('runFlow'), entryUrn: z.string().default(''), agentRef: z.string().default('') })), { errors: false });
 browser = await chromium.launch({ headless: true });
 if (process.env.RUNS_CAPTURE_DIR) await mkdir(process.env.RUNS_CAPTURE_DIR, { recursive: true });
 for (const width of [390, 1280]) for (const dark of [false, true]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error('browser pageerror:', e.message); });
  await page.route('**/__runs_fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>App Runs component fixture</title>' }));
  try {
   await page.goto(new URL('/__runs_fixture', origin).href);
   await page.evaluate(({ css, dark, runForm }) => {
    document.head.innerHTML = `<style>${css}</style>`; document.documentElement.classList.toggle('dark', dark); document.body.className = 'bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100'; document.body.innerHTML = '<main class="mx-auto min-w-0 max-w-7xl p-4" id="fixture"></main>';
    window.runsData = { app: { id: 'a', name: 'Runs fixture', organizationId: null }, page: 3, total: 100, statuses: [], sort: 'createdAt', dir: 'desc', failed: false, explicitState: true, runAgents: null, runForm,
     flowsPage: { offset: 0, count: 1, total: 1, firstHref: null, previousHref: null, nextHref: null },
     flows: [{ entry: { id: 'n', memoryId: 'm', loc: 'flow', name: 'Long flow name for a phone viewport', urn: 'hrn:node:example.test:fixture:flow' }, stepCount: 2, branchCount: 1 }],
     runs: Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, appId: 'a', organizationId: null, agentId: null, userId: null, triggerKind: 'MANUAL', triggerId: null, entryNodeUrn: `hrn:node:example.test:fixture:long-entry-with-many-segments:${i}`, eventData: null, policy: null, budgetTokens: null, budgetActions: null, status: 'COMPLETED', curNodeUrn: null, parentRunId: null, failure: null, timeoutMs: null, attempts: 1, startedAt: '2026-11-01T00:00:00Z', finishedAt: '2026-11-01T00:00:03Z', createdAt: '2026-11-01T00:00:00Z', createdBy: null })) };
   }, { css, dark, runForm });
   await page.evaluate(async () => {
    const { setStubPage } = await import('/src/lib/test/stubs/app-stores.ts');
    setStubPage('http://localhost/app/apps/a?tab=runs&page=3&sort=createdAt&dir=desc');
    const { mountAppRuns } = await import('/src/lib/test/fixtures/app-runs-harness.ts');
    window.stopRuns = mountAppRuns(document.getElementById('fixture'), window.runsData);
   });
   await page.locator('th').filter({ hasText: /^Duration/ }).waitFor();
   assert.equal(await page.locator('tbody tr').count(), 20);
   assert.equal(await page.locator('thead th').count(), 7);
   assert.equal(await page.locator('th').filter({ hasText: /^Duration/ }).getByRole('button').count(), 0);
   assert.equal(await page.getByLabel('Sort runs by').inputValue(), 'createdAt');
   assert.equal(await page.getByText('Showing the first', { exact: false }).count(), 0);
   assert.equal(await page.getByText('Pages step through this App’s runnable nodes; only Flow entry nodes are listed.', { exact: true }).count(), 1);
   assert.equal(await page.locator('table').getByText('Showing the first', { exact: false }).count(), 0);
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}/${dark}: page overflow`);
   assert.equal(await page.getByRole('textbox', { name: /Search/ }).count(), 0);
   if (process.env.RUNS_CAPTURE_DIR) await page.screenshot({ path: `${process.env.RUNS_CAPTURE_DIR}/runs-${width}-${dark ? 'dark' : 'light'}.png`, fullPage: true });
   const sort = page.locator('th').filter({ hasText: /^Started/ }).getByRole('button', { name: 'Started', exact: true });
   await sort.focus(); await page.keyboard.press('Enter');
   let url = await page.evaluate(async () => { const { navigationCalls } = await import('/src/lib/test/stubs/app-navigation.ts'); return navigationCalls.at(-1)?.args[0]; });
   assert.equal(new URL(url, origin).searchParams.get('sort'), 'startedAt');
   assert.equal(new URL(url, origin).searchParams.has('page'), false);
   await page.getByRole('button', { name: 'Next', exact: true }).click();
   url = await page.evaluate(async () => { const { navigationCalls } = await import('/src/lib/test/stubs/app-navigation.ts'); return navigationCalls.at(-1)?.args[0]; });
   assert.equal(new URL(url, origin).searchParams.get('page'), '4');
   await page.evaluate(async () => {
    const nav = await import('/src/lib/test/stubs/app-navigation.ts');
    nav.resetNavigationCalls();
    nav.navigationHooks.onGoto = () => new Promise(resolve => { window.releaseRunNavigation = resolve; });
   });
   const failed = page.getByLabel('Failed', { exact: true });
   await failed.focus(); await page.keyboard.press('Space');
   await page.waitForFunction(() => document.querySelector('[aria-busy="true"]'));
   assert.equal(await failed.evaluate(el => document.activeElement === el), true, 'pending filter navigation keeps native keyboard focus');
   await page.evaluate(() => window.releaseRunNavigation());
   await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
   await page.evaluate(async () => {
    const nav = await import('/src/lib/test/stubs/app-navigation.ts');
    for (const guard of nav.navigationGuards.filter(x => x.fn === 'afterNavigate')) guard.callback({ type: 'goto' });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
   });
   assert.equal(await failed.evaluate(el => document.activeElement === el), true, 'modeled router completion does not steal a live filter focus');
   assert.equal(errors.length, 0, errors.join('\n'));
   console.log(`${width}/${dark ? 'dark' : 'light'}: PASS 20 rows, 7 columns, paged Flows, contained grid, keyboard sort, URL pager, native pending-filter focus; controlled fixture/router completion only`);
  } finally { await page.close(); }
 }
} finally { await browser?.close(); await server.close(); }
