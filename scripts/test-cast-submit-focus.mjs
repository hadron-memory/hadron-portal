// portal#1796: keyboard focus must not drop to <body> when the Cast button's submit begins or when
// the cast succeeds. Before the fix the submit button was `disabled` while casting: Chromium drops
// focus from a control that becomes disabled, and a keyboard user lost their place. It is now
// `aria-disabled` (still focusable, double-submit refused in onSubmit), and a clean cast hands focus
// to the "Cast a worker" opener because the composer (and the focused Cast button) unmounts.
// jsdom does not move focus off a disabled control, so this is real Chromium with the real page.
// `$app/forms` is app-forms-browser.ts: a real fetch round trip with superforms' own callbacks; the POST to ?/castWorker is faked at
// the network layer and held until the probe releases it, so the pending state can be observed.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:cast-submit-focus
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const STUBS = {
  '$app/stores': '/src/lib/test/stubs/app-stores.ts',
  '$app/navigation': '/src/lib/test/stubs/app-navigation.ts',
  '$app/state': '/src/lib/test/stubs/app-state.ts',
  '$app/forms': '/src/lib/test/stubs/app-forms-browser.ts',
  '$app/environment': '/src/lib/test/stubs/app-environment.ts',
  '$env/dynamic/public': '/src/lib/test/stubs/env-dynamic-public.ts',
};
const MOUNT_RETRYABLE = /Execution context was destroyed|navigation|effect_orphan/i;

const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  // superforms (a dependency) imports `$app/forms` itself; the transform below only reaches app code.
  optimizeDeps: { exclude: ['sveltekit-superforms'] },
  resolve: { alias: [{ find: /^\$app\/forms$/, replacement: fileURLToPath(new URL('../src/lib/test/stubs/app-forms-browser.ts', import.meta.url)) }] },
  plugins: [{
    name: 'stub-app-modules',
    enforce: 'pre',
    transform(code) {
      if (!code.includes("from '$app/") && !code.includes("from '$env/")) return null;
      let out = code;
      for (const [mod, stub] of Object.entries(STUBS)) out = out.replaceAll(`from '${mod}'`, `from '${stub}'`);
      return out;
    },
  }],
});
await server.listen();
const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
const browser = await chromium.launch({ headless: true });

const active = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el && el !== document.body ? `${el.tagName}:${(el.textContent ?? '').trim().slice(0, 24)}` : 'BODY';
});

// The answer superforms reads (plain JSON through app-forms-browser.ts): { form: { id, valid, posted, errors, data, message } }.
const successBody = (id) => JSON.stringify({
  type: 'success', status: 200,
  data: { form: { id, valid: true, posted: true, errors: {}, data: {}, message: { type: 'success', text: 'Worker cast.' } } },
});

async function mount(page) {
  await page.route('**/__blank', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>cast</title>' }));
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(new URL('/__blank', origin).href);
      await page.addStyleTag({ content: css });
      await page.evaluate(async () => {
        await import('/src/lib/test/fixtures/cast-submit-focus-harness.ts');
        window.__h = await window.__mountCastPage();
      });
      return;
    } catch (e) {
      if (attempt >= 3 || !MOUNT_RETRYABLE.test(String(e))) throw e;
      console.log(`retry cold Vite mount ${attempt + 1}: ${String(e).split('\n')[0]}`);
    }
  }
}

async function run({ width, dark }) {
  const label = `${width}px ${dark ? 'dark' : 'light'}`;
  const context = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await mount(page);
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);

  // The AI Team tab asks for its roster on open; answer it locally so nothing reaches the dev server.
  await page.route('**/roster', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ kind: 'hidden' }) }));
  // Hold the POST so the pending state is observable; count how many reach the wire.
  let posts = 0;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route(/castWorker/, async (route) => {
    posts++;
    const id = await page.evaluate(() => document.querySelector('input[name="__superform_id"]').value);
    await held;
    await route.fulfill({ contentType: 'application/json', body: successBody(id) });
  });

  await page.getByRole('button', { name: 'Cast a worker' }).click();
  await page.selectOption('select[name="agentId"]', 'agent-a');
  await page.fill('input[name="name"]', 'Probe');
  await page.check('input[name="reporting"][value="none"]');

  // Keyboard path: Tab-focus the Cast button, Enter submits.
  const cast = page.getByRole('button', { name: 'Cast', exact: true });
  await cast.focus();
  assert.equal(await active(page), 'BUTTON:Cast', `${label}: Cast button focused before submit`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('form[action="?/castWorker"] button[type=submit]')?.textContent?.includes('Casting'), undefined, { timeout: 5000 });

  assert.notEqual(await active(page), 'BODY', `${label}: focus dropped to <body> when the cast began`);
  assert.equal(await active(page), 'BUTTON:Casting…', `${label}: focus stays on the Cast button while casting`);
  assert.equal(await page.evaluate(() => document.querySelector('form[action="?/castWorker"] button[type=submit]').getAttribute('aria-disabled')), 'true', `${label}: Cast button announces aria-disabled`);

  // Double-submit guard: a second activation while casting reaches no second request.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  assert.equal(posts, 1, `${label}: a second Enter while casting must not send a second request`);

  release();
  await page.waitForFunction(() => !document.querySelector('form[action="?/castWorker"]'));
  await page.waitForFunction(() => document.activeElement && document.activeElement !== document.body, undefined, { timeout: 3000 })
    .catch(() => {});
  assert.equal(await active(page), 'BUTTON:Cast a worker', `${label}: after a clean cast focus lands on the Cast a worker opener, not <body>`);
  assert.deepEqual(errors, [], `${label}: no page errors`);
  console.log(`ok  ${label}: focus kept while casting, one request, opener focused after success`);
  await context.close();
}

try {
  for (const width of [1280, 390]) for (const dark of [false, true]) await run({ width, dark });
} finally {
  await browser.close();
  await server.close();
}
