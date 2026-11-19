// portal#1796: keyboard focus must not drop to <body> when the Cast button's submit begins or when
// the cast succeeds. Before the fix the submit button was `disabled` while casting: Chromium drops
// focus from a control that becomes disabled, and a keyboard user lost their place. It is now
// `aria-disabled` (still focusable; Superforms' multipleSubmits: 'prevent' refuses a second submit
// before onSubmit runs), and a clean cast hands focus to the "Cast a worker" opener because the
// composer (and the focused Cast button) unmounts, unless the reader already moved focus elsewhere.
// Legs: clean cast from the Cast button (Enter, then a second Enter and a Space), a refused cast
// (WORKER_NAME_TAKEN) and a failed request (message shown, name kept, focus on a named control),
// the Name-input control, and focus that moved away while the request was out.
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
const MOUNT_RETRYABLE = /Execution context was destroyed|effect_orphan/i;

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
  return el && el !== document.body ? `${el.tagName}:${el.getAttribute('name') ?? (el.textContent ?? '').trim().slice(0, 24)}` : 'BODY';
});

// The answer superforms reads (plain JSON through app-forms-browser.ts): { form: { id, valid, posted, errors, data, message } }.
const successBody = (id) => JSON.stringify({
  type: 'success', status: 200,
  data: { form: { id, valid: true, posted: true, errors: {}, data: {}, message: { type: 'success', text: 'Worker cast.' } } },
});

// A refused cast: kit answers a failure whose form carries the refusal as its message.
const refusalBody = (id, name) => JSON.stringify({
  type: 'failure', status: 409,
  data: { form: { id, valid: false, posted: true, errors: {}, data: { name }, message: { type: 'error', text: 'That name is already taken in this App.' } } },
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

  // Both stubs go in BEFORE mount: the AI Team tab asks for its roster the moment it opens, so a
  // route added afterwards races that request to the dev server (not hermetic, flaky pageerror).
  // Count roster requests at the page and the ones the stub answered: any gap is a request that
  // reached the dev server, i.e. the stub was registered too late.
  let rosterSeen = 0;
  let rosterStubbed = 0;
  page.on('request', (r) => { if (/\/roster(\?|$)/.test(r.url())) rosterSeen++; });
  await page.route('**/roster', (r) => {
    rosterStubbed++;
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ kind: 'hidden' }) });
  });
  // The next POST to ?/castWorker answers per `plan`: held until `release()`, then success, a
  // refusal, or a network failure. `posts` counts what reaches the wire.
  let posts = 0;
  let plan = null;
  const arm = (kind) => {
    let release;
    plan = { kind, gate: new Promise((resolve) => { release = resolve; }) };
    posts = 0;
    return release;
  };
  await page.route(/castWorker/, async (route) => {
    posts++;
    const { kind, gate } = plan;
    const form = await page.evaluate(() => ({
      id: document.querySelector('input[name="__superform_id"]').value,
      name: document.querySelector('input[name="name"]').value,
    }));
    await gate;
    if (kind === 'abort') return route.abort();
    await route.fulfill({ contentType: 'application/json', body: kind === 'refuse' ? refusalBody(form.id, form.name) : successBody(form.id) });
  });

  await mount(page);
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);

  const castForm = 'form[action="?/castWorker"]';
  const casting = () => page.waitForFunction((sel) => document.querySelector(`${sel} button[type=submit]`)?.textContent?.includes('Casting'), castForm, { timeout: 5000 });
  const settled = () => page.waitForFunction((sel) => !document.querySelector(`${sel} button[type=submit]`)?.textContent?.includes('Casting'), castForm, { timeout: 5000 });
  const prepare = async () => {
    if (!(await page.$(castForm))) await page.getByRole('button', { name: 'Cast a worker' }).click();
    await page.selectOption('select[name="agentId"]', 'agent-a');
    await page.fill('input[name="name"]', 'Probe');
    await page.check('input[name="reporting"][value="none"]');
  };
  const cast = page.getByRole('button', { name: 'Cast', exact: true });
  const nameInput = page.locator('input[name="name"]');
  const alertText = () => page.locator('[data-testid="cast-answer-alert"]').innerText();
  const closed = () => page.waitForFunction((sel) => !document.querySelector(sel), castForm);
  const expectOpener = async (why) => {
    await page.waitForFunction(() => document.activeElement && document.activeElement !== document.body, undefined, { timeout: 3000 }).catch(() => {});
    assert.equal(await active(page), 'BUTTON:Cast a worker', `${label}: ${why}`);
  };

  // 1. Refused cast, started with Space from the Cast button: the message shows, the name is kept,
  //    the composer stays open and focus sits on a named control, never <body>.
  let release = arm('refuse');
  await prepare();
  await cast.focus();
  assert.equal(await active(page), 'BUTTON:Cast', `${label}: Cast button focused before submit`);
  await page.keyboard.press('Space');
  await casting();
  assert.notEqual(await active(page), 'BODY', `${label}: focus dropped to <body> when the cast began`);
  assert.equal(await active(page), 'BUTTON:Casting…', `${label}: focus stays on the Cast button while casting`);
  assert.equal(await page.evaluate((sel) => document.querySelector(`${sel} button[type=submit]`).getAttribute('aria-disabled'), castForm), 'true', `${label}: Cast button announces aria-disabled`);
  // Double-submit guard: a second Enter and a second Space while casting reach no second request.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  assert.equal(posts, 1, `${label}: a second Enter or Space while casting must not send a second request`);
  release();
  await settled();
  assert.match(await alertText(), /already taken/, `${label}: refusal message shown`);
  assert.equal(await nameInput.inputValue(), 'Probe', `${label}: refused cast keeps the typed name`);
  assert.equal(await active(page), 'BUTTON:Cast', `${label}: after a refusal focus stays on the Cast button`);

  // 2. Failed request (the answer never arrives): "could not be confirmed", name kept, focus kept.
  release = arm('abort');
  await page.keyboard.press('Enter');
  release();
  await casting().catch(() => {});
  await settled();
  await page.waitForFunction(() => /could not be confirmed/.test(document.querySelector('[data-testid="cast-answer-alert"]')?.textContent ?? ''), undefined, { timeout: 5000 });
  assert.equal(await nameInput.inputValue(), 'Probe', `${label}: failed request keeps the typed name`);
  assert.equal(await active(page), 'BUTTON:Cast', `${label}: after a failed request focus stays on the Cast button`);

  // 3. Control: submit from the Name input. Focus stays in that input while casting.
  release = arm('success');
  await nameInput.focus();
  await page.keyboard.press('Enter');
  await casting();
  assert.equal(await active(page), 'INPUT:name', `${label}: focus stays in the Name input while casting`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  assert.equal(posts, 1, `${label}: a second Enter in the Name input must not send a second request`);
  release();
  await closed();
  await expectOpener('after a cast submitted from the Name input focus lands on the opener, not <body>');

  // 4. Focus moved to another real control while the request was out: the opener must not steal it.
  release = arm('success');
  await prepare();
  await cast.focus();
  await page.keyboard.press('Enter');
  await casting();
  await page.evaluate(() => {
    const other = [...document.querySelectorAll('[role="tab"], a[href]')].find((el) => !el.closest('form') && el.offsetParent !== null);
    if (!other) throw new Error('no focusable control outside the composer');
    other.focus();
    window.__movedTo = other;
  });
  release();
  await closed();
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.activeElement === window.__movedTo), true, `${label}: focus the reader moved elsewhere is not pulled back to the opener`);

  // 5. Clean cast from the Cast button: opener focused after the composer unmounts.
  release = arm('success');
  await prepare();
  await cast.focus();
  await page.keyboard.press('Enter');
  await casting();
  release();
  await closed();
  await expectOpener('after a clean cast focus lands on the Cast a worker opener, not <body>');

  assert.ok(rosterSeen > 0, `${label}: the AI Team tab asked for its roster (else the stub ordering pin proves nothing)`);
  assert.equal(rosterSeen, rosterStubbed, `${label}: every roster request was answered by the stub, none reached the dev server`);
  assert.deepEqual(errors, [], `${label}: no page errors`);
  console.log(`ok  ${label}: focus kept while casting, one request, refusal and failure keep name and focus, opener focused after success`);
  await context.close();
}

try {
  for (const width of [1280, 390]) for (const dark of [false, true]) await run({ width, dark });
} finally {
  await browser.close();
  await server.close();
}
