// #2092: native Chromium geometry on the real Conversation Editor component.
// Synthetic fixture + compiled CSS + app-shell sidebar. No API/server writes.
// Toolbar controls stay reachable; a clipped ancestor cannot fake no overflow.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright';

const stub = (name) => resolve('src/lib/test/stubs', name);
const server = await createServer({
  configFile: false,
  cacheDir: 'node_modules/.vite-conversation-toolbar-layout',
  optimizeDeps: { entries: ['src/lib/test/fixtures/conversation-toolbar-harness.ts'], exclude: ['sveltekit-superforms'] },
  server: { host: '127.0.0.1', port: 0 },
  resolve: { alias: {
    $lib: resolve('src/lib'), '$app/navigation': stub('app-navigation.ts'),
    '$app/environment': stub('app-environment.ts'), '$app/stores': stub('app-stores.ts'),
    '$app/state': stub('app-state.ts'), '$app/forms': stub('app-forms.ts'),
    '$env/dynamic/public': stub('env-dynamic-public.ts'),
  } },
  plugins: [tailwindcss(), svelte()],
});
const WIDTHS = process.env.TOOLBAR_WIDTH ? [Number(process.env.TOOLBAR_WIDTH)] : [320, 390, 768, 1280];
const failures = [];
const results = [];
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });
  // Explicit setup, not a retried measured case: discover/prebundle the dynamic
  // fixture graph BEFORE mounting components. A cold optimizer reload must not
  // split Svelte runtimes during the first measured mount (#2137 LOCAL).
  const warm = await browser.newPage();
  await warm.goto(new URL('/@vite/client', origin).href);
  await warm.evaluate(async () => { await import('/src/lib/test/fixtures/conversation-toolbar-harness.ts'); });
  await warm.waitForLoadState('networkidle');
  await warm.close();
  if (process.env.TOOLBAR_SHOTS) await mkdir(process.env.TOOLBAR_SHOTS, { recursive: true });
  for (const width of WIDTHS) for (const dark of [false, true]) for (const state of ['editing', 'blocked', 'error']) {
    const label = `${width}/${dark ? 'dark' : 'light'}/${state}`;
    const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: width < 640 });
    const errors = [], requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/agent-chat/revisions', async (route) => {
      const body = route.request().postDataJSON(); requests.push(body);
      const response = body.action === 'lock'
        ? state === 'blocked' ? { locked: false, lockedBy: 'Another synthetic editor with a long display name' } : { locked: true, expiresAt: '2099-01-01T00:00:00Z' }
        : body.action === 'save' ? { revision: 1 } : { revisions: [] };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
    });
    try {
      await page.goto(new URL('/@vite/client', origin).href);
      await page.evaluate(({ css, dark }) => {
        document.head.innerHTML = `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>`;
        document.documentElement.classList.toggle('dark', dark);
        document.body.className = 'bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
        document.body.innerHTML = '<div class="flex gap-4 px-4 py-8 sm:gap-8 sm:px-6"><aside class="w-48 shrink-0 hidden sm:flex">Sidebar</aside><main class="min-w-0 flex-1" id="fixture"></main></div>';
      }, { css, dark });
      await page.evaluate(async (error) => {
        const h = await import('/src/lib/test/fixtures/conversation-toolbar-harness.ts');
        window.stopToolbar = await h.mountConversationToolbar(document.getElementById('fixture'), error);
      }, state === 'error');
      await page.getByText(state === 'blocked' ? 'Locked by Another synthetic editor with a long display name' : 'Editing', { exact: true }).waitFor();
      await page.locator('form[action="?/addConversation"] input[name="name"]').fill('New synthetic conversation');
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const geometry = await page.evaluate(() => {
        const form = document.querySelector('form[action="?/addConversation"]');
        const toolbar = form.parentElement.parentElement;
        const elements = [form.querySelector('input[name="name"]'), form.querySelector('button'), ...[...toolbar.querySelectorAll('button')].filter((b) => ['Save revision', 'Revisions'].includes(b.textContent.trim())), toolbar.firstElementChild];
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          toolbarOverflow: toolbar.scrollWidth - toolbar.clientWidth,
          elements: elements.map((el) => {
            const r = el.getBoundingClientRect();
            let a = el.parentElement, clipped = false;
            while (a && a !== document.body) { const b = a.getBoundingClientRect(); const o = getComputedStyle(a).overflowX; if (['hidden', 'clip'].includes(o) && (r.left < b.left - 1 || r.right > b.right + 1)) clipped = true; a = a.parentElement; }
            return { text: el.textContent.trim() || el.getAttribute('placeholder'), x: r.left, right: r.right, w: r.width, h: r.height, clipped };
          }),
          coarse: matchMedia('(pointer: coarse)').matches,
        };
      });
      const check = (ok, msg) => { if (!ok) failures.push(`${label}: ${msg}`); };
      check(geometry.overflow <= 0, `page overflow ${geometry.overflow}px`);
      check(geometry.toolbarOverflow <= 0, `toolbar overflow ${geometry.toolbarOverflow}px`);
      check(geometry.elements.length === 5, 'toolbar action or lock indicator missing');
      for (const item of geometry.elements) check(item.w > 0 && item.h > 0 && item.x >= 0 && item.right <= width && !item.clipped, `unreachable ${item.text}: ${JSON.stringify(item)}`);
      if (width < 640) check(geometry.coarse, 'phone is not pointer:coarse');
      const form = page.locator('form[action="?/addConversation"]');
      const values = await form.evaluate(async (f) => { const h = await import('/src/lib/test/fixtures/conversation-toolbar-harness.ts'); return h.conversationSubmitValues(f); });
      check(!values.cancelled && values.values.name === 'New synthetic conversation' && values.values.systemMemoryId === 'memory-fixture', 'add conversation form values/validation changed');
      const save = page.getByRole('button', { name: 'Save revision', exact: true });
      check(await save.isDisabled() === (state === 'blocked'), 'Save lock gating changed');
      if (state !== 'blocked') { await save.click(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save revision')?.disabled); check(requests.some((r) => r.action === 'save' && r.agentId === 'agent-fixture'), 'Save revision not sent'); }
      await page.getByRole('button', { name: 'Revisions', exact: true }).click();
      await page.getByRole('button', { name: 'Hide revisions', exact: true }).waitFor();
      check(await page.getByRole('heading', { name: 'Revisions', exact: true }).count() === 1, 'Revisions did not open');
      await page.getByRole('button', { name: 'Hide revisions', exact: true }).click();
      check(errors.length === 0, `page errors: ${errors.join(' | ')}`);
      results.push({ label, ...geometry });
      if (process.env.TOOLBAR_SHOTS) await page.screenshot({ path: `${process.env.TOOLBAR_SHOTS}/${width}-${dark ? 'dark' : 'light'}-${state}.png`, fullPage: true });
      await page.evaluate(() => window.stopToolbar());
    } finally { await page.close(); }
  }
} finally { await browser?.close(); await server.close(); }
if (process.env.TOOLBAR_RESULTS) { const { writeFile } = await import('node:fs/promises'); await writeFile(process.env.TOOLBAR_RESULTS, JSON.stringify(results, null, 2)); }
assert.equal(failures.length, 0, `Conversation toolbar failures:\n${failures.join('\n')}`);
console.log(`PASS conversation toolbar: ${WIDTHS.length} widths ×2 themes ×3 states; controls, lock, form values and revision actions`);
