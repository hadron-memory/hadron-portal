/**
 * portal#2249 browser proofs: the App type renders as its label — the same
 * text the Settings select shows, icon included — in the Profile tab's Type
 * row, the Settings read-only Type row and the Settings options, in light and
 * dark. Screenshots land in docs/proofs/app-type-labels-2249/ for the PR.
 *
 * Drives the same fixture-mounted page as the client-lane test
 * (app-type-label.client.test.ts → app-type-label-harness): the real
 * +page.svelte, no backend. The label comes from the shared source alone, so
 * an IOT app reads "📡 IoT" on every surface, whatever the raw enum says.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname: paths with spaces or a Windows host break on
// the raw pathname (portal#2248 review, Gil P3 5).
const OUT = fileURLToPath(new URL('../docs/proofs/app-type-labels-2249/', import.meta.url));
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
const cssUrl = new URL('src/app.css?direct', origin);
const cssRes = await fetch(cssUrl);
if (!cssRes.ok) throw new Error(`the stylesheet fetch failed for ${cssUrl}: ${cssRes.status}`);
const css = await cssRes.text();

const EXPECTED_OPTIONS = ['💻 Workstation', '💬 Chatbot', '🤖 Agent', '⚙️ Automation', '☁️ Cloud', '📡 IoT'];

const browser = await chromium.launch({ headless: true });
const results = [];

async function shoot(name, { dark, tab }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.route('**/__type_fixture*', (r) => r.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>f</title>`,
  }));
  await page.goto(new URL('/__type_fixture', origin).href);
  await page.addStyleTag({ content: css });
  await page.evaluate((dark) => {
    document.documentElement.classList.toggle('dark', dark);
    document.body.className = 'bg-white dark:bg-zinc-950';
  }, dark);
  await page.evaluate(async () => { await import('/src/lib/test/fixtures/app-type-label-harness.ts'); });
  await page.evaluate(async (options) => {
    window.__h = await window.__mountAppTypePage(options);
  }, { tab, appType: 'IOT' });
  // Not a fixed sleep loop: wait for the panel the shot is of.
  await page.waitForSelector(`#panel-${tab}`);

  const row = tab === 'profile' ? '[data-testid="profile-type"]' : '[data-testid="settings-type"]';
  await page.waitForSelector(row);
  const text = (await page.locator(row).textContent())?.trim();
  if (text !== '📡 IoT') throw new Error(`${name}: the ${tab} Type row shows "${text}", not "📡 IoT"`);

  if (tab === 'settings') {
    // The options come from the same shared source; assert them in the DOM
    // after the screenshot is taken (Edit swaps the read-only card for the
    // form, and the shot is of the read-only row).
    await page.screenshot({ path: `${OUT}${name}.png`, fullPage: false });
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    // attached, not visible: an <option> inside a closed <select> is never
    // "visible" to playwright, and the assertion reads text, not geometry.
    await page.waitForSelector('#appType option', { state: 'attached' });
    const options = await page.$$eval('#appType option', (os) => os.map((o) => (o.textContent || '').trim()));
    if (JSON.stringify(options) !== JSON.stringify(EXPECTED_OPTIONS)) {
      throw new Error(`${name}: the Settings options are ${JSON.stringify(options)}, not ${JSON.stringify(EXPECTED_OPTIONS)}`);
    }
  } else {
    await page.screenshot({ path: `${OUT}${name}.png`, fullPage: false });
  }

  results.push({ name, tab, typeRow: text, options: tab === 'settings' ? EXPECTED_OPTIONS.length : null });
  await page.evaluate(() => window.__h.unmount());
  await context.close();
}

// try/finally (portal#2248 review, Gil P3 5): a failed assertion must not
// leave the vite server and the browser to process-exit cleanup.
try {
  await shoot('1440-light-profile', { dark: false, tab: 'profile' });
  await shoot('1440-dark-profile', { dark: true, tab: 'profile' });
  await shoot('1440-light-settings', { dark: false, tab: 'settings' });
  await shoot('1440-dark-settings', { dark: true, tab: 'settings' });
  console.log(JSON.stringify(results, null, 1));
} finally {
  await browser.close();
  await server.close();
}
