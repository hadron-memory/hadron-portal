/**
 * portal#2238 browser proofs: the App page's roster states in a real
 * Chromium, light and dark, desktop and phone width. Screenshots land in
 * docs/proofs/app-roster-2238/ for the PR.
 *
 * Drives the same fixture-mounted page as the client-lane tests
 * (app-page-roster-harness): the real +page.svelte, no backend, every
 * network call local to the page. The fetch log proves the acceptance line
 * that opening on a non-staff tab starts no roster request — the first
 * /roster call appears only after the AI Team tab is clicked.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../docs/proofs/app-roster-2238/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const STUBS = {
  '$app/stores': '/src/lib/test/stubs/app-stores.ts',
  '$app/navigation': '/src/lib/test/stubs/app-navigation.ts',
  '$app/state': '/src/lib/test/stubs/app-state.ts',
  '$app/forms': '/src/lib/test/stubs/app-forms.ts',
  '$app/environment': '/src/lib/test/stubs/app-environment.ts',
  '$env/dynamic/public': '/src/lib/test/stubs/env-dynamic-public.ts',
};

const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'stub-app-modules',
    enforce: 'pre',
    transform(code, id) {
      if (!code.includes("from '$app/") && !code.includes("from '$env/")) return null;
      let out = code;
      for (const [mod, stub] of Object.entries(STUBS)) {
        out = out.replaceAll(`from '${mod}'`, `from '${stub}'`);
      }
      return out;
    },
  }],
});
await server.listen();
const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
const css = await (await fetch(new URL('src/app.css?direct', origin))).text();

const rosterOk = {
  kind: 'ok',
  byWorker: {
    w1: {
      worker: { id: 'w1' },
      checkStatus: { status: 'RUNNING', pendingReason: null },
      pausedUntil: null,
      currentTask: { id: 't1', title: 'Fix the login handoff', status: 'RUNNING', handle: 'AT0.9' },
      heldBy: null, heldAt: null,
    },
    w2: {
      worker: { id: 'w2' },
      checkStatus: { status: 'PENDING', pendingReason: 'TEAM_PAUSED' },
      pausedUntil: '2026-11-20T09:00:00.000Z',
      currentTask: null,
      heldBy: null, heldAt: null,
    },
  },
};

const browser = await chromium.launch({ headless: true });
const results = [];

async function shoot(name, { width, height, dark, roster, state }) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.route('**/__roster_fixture*', (r) => r.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>f</title>`,
  }));
  await page.goto(new URL('/__roster_fixture', origin).href);
  await page.addStyleTag({ content: css });
  await page.evaluate((dark) => {
    document.documentElement.classList.toggle('dark', dark);
    document.body.className = 'bg-white dark:bg-zinc-950';
  }, dark);
  await page.evaluate(async () => { await import('/src/lib/test/fixtures/app-page-roster-harness.ts'); });
  await page.evaluate((mode) => { window.__roster = mode; }, roster.mode);
  await page.evaluate(async () => { window.__h = await window.__mountAppPage(); });

  try {
    if (state !== 'chats') {
      await page.click('#tab-staff');
      if (state === 'loaded' || state === 'failed') {
        // Wait past the fetch microtask chain for the settled render.
        await page.waitForFunction(
          (s) => document.querySelector('#panel-staff')?.textContent?.includes(s),
          state === 'loaded' ? 'Fix the login handoff' : 'could not be loaded',
          { timeout: 8000 },
        );
      } else {
        await page.waitForFunction(() => document.querySelector('#panel-staff')?.textContent?.includes('Loading'), undefined, { timeout: 8000 });
      }
    }
  } catch (e) {
    console.log('TIMEOUT-DIAG', name, {
      panel: await page.evaluate(() => document.querySelector('#panel-staff')?.textContent?.slice(0, 300)),
      fetchLog: await page.evaluate(() => window.__fetchLog),
      pageErrors: await page.evaluate(() => window.__pageErrors ?? null),
    });
    throw e;
  }
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  const log = await page.evaluate(() => window.__fetchLog);
  results.push({ name, rosterCalls: log.filter((u) => u.endsWith('/roster')).length });
  await page.evaluate(() => window.__h.unmount());
  await context.close();
}

// The no-request-on-open line: mount on the default chats tab and read the
// fetch log BEFORE any click. Nothing may have asked for /roster.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.route('**/__roster_fixture*', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>f</title>' }));
  await page.goto(new URL('/__roster_fixture', origin).href);
  await page.addStyleTag({ content: css });
  await page.evaluate(async () => { await import('/src/lib/test/fixtures/app-page-roster-harness.ts'); });
  await page.evaluate(() => { window.__roster = 'hang'; });
  await page.evaluate(async () => { window.__h = await window.__mountAppPage(); });
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => window.__fetchLog.filter((u) => u.endsWith('/roster')).length);
  await page.click('#tab-staff');
  await page.waitForFunction(() => document.querySelector('#panel-staff')?.textContent?.includes('Loading'), undefined, { timeout: 5000 });
  const after = await page.evaluate(() => window.__fetchLog.filter((u) => u.endsWith('/roster')).length);
  results.push({ name: 'NO-ROSTER-ON-CHATS-OPEN', rosterCallsBeforeStaffClick: before, rosterCallsAfter: after });
  await page.evaluate(() => window.__h.unmount());
  await context.close();
}

await shoot('1440-light-loading', { width: 1440, height: 900, dark: false, roster: { mode: 'hang' }, state: 'loading' });
await shoot('1440-light-loaded', { width: 1440, height: 900, dark: false, roster: { mode: rosterOk }, state: 'loaded' });
await shoot('1440-light-failed', { width: 1440, height: 900, dark: false, roster: { mode: { kind: 'failed' } }, state: 'failed' });
await shoot('1440-dark-loading', { width: 1440, height: 900, dark: true, roster: { mode: 'hang' }, state: 'loading' });
await shoot('1440-dark-loaded', { width: 1440, height: 900, dark: true, roster: { mode: rosterOk }, state: 'loaded' });
await shoot('390-light-loading', { width: 390, height: 844, dark: false, roster: { mode: 'hang' }, state: 'loading' });
await shoot('390-light-loaded', { width: 390, height: 844, dark: false, roster: { mode: rosterOk }, state: 'loaded' });
await shoot('390-dark-failed', { width: 390, height: 844, dark: true, roster: { mode: { kind: 'failed' } }, state: 'failed' });

console.log(JSON.stringify(results, null, 1));
await browser.close();
await server.close();
