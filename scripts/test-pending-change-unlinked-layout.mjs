// portal#2586: the unlinked hint inside PendingChange's `flex flex-wrap` action row must read
// correctly beside Withdraw at phone widths: the hint wraps in its own width, Withdraw drops
// below it without overlapping, and the page never scrolls sideways. Real Chromium, the real
// component mounted through Vite with the compiled app.css, in the column the page's 16px
// gutters leave at each viewport, light and dark.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:pending-change-unlinked-layout
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright';

const stub = (name) => resolve('src/lib/test/stubs', name);
const server = await createServer({
  configFile: false,
  cacheDir: 'node_modules/.vite-pending-change-unlinked-layout',
  optimizeDeps: { entries: ['src/lib/test/fixtures/pending-change-harness.ts'] },
  server: { host: '127.0.0.1', port: 0 },
  resolve: { alias: {
    $lib: resolve('src/lib'), '$app/navigation': stub('app-navigation.ts'),
    '$app/environment': stub('app-environment.ts'), '$app/stores': stub('app-stores.ts'),
    '$app/state': stub('app-state.ts'), '$app/forms': stub('app-forms.ts'),
    '$env/dynamic/public': stub('env-dynamic-public.ts'),
  } },
  plugins: [tailwindcss(), svelte()],
});
let browser;
async function gotoFixtureDocument(page, origin) {
  await page.route('**/__pending_change_fixture*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Pending change</title>' }));
  const response = await page.goto(new URL('/__pending_change_fixture', origin).href);
  assert.equal(response?.status(), 200, `fixture document was not served inert (HTTP ${response?.status()})`);
}

try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const cssResponse = await fetch(new URL('src/app.css?direct', origin));
  assert.ok(cssResponse.ok, `compiled app.css was not served (HTTP ${cssResponse.status})`);
  const css = await cssResponse.text();
  assert.ok(css.length > 1000, `compiled app.css looks empty (${css.length} bytes)`);
  browser = await chromium.launch({ headless: true });

  for (const width of [320, 360, 414, 768]) {
    for (const dark of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await gotoFixtureDocument(page, origin);
      await page.evaluate(([css, dark]) => {
        document.head.innerHTML = '';
        document.documentElement.classList.toggle('dark', dark);
        document.body.innerHTML = `<style>${css}</style><main id="col"></main>`;
      }, [css, dark]);
      await page.addStyleTag({ content: `#col { margin: 0 16px; }` });
      await page.evaluate(async () => {
        const { mountUnlinkedPendingChange } = await import('/src/lib/test/fixtures/pending-change-harness.ts');
        mountUnlinkedPendingChange(document.getElementById('col'));
      });
      await page.waitForSelector('[data-testid="pending-change-actions"]');

      const measure = () => page.evaluate(() => {
        const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
        const card = document.querySelector('[data-testid="pending-change"]');
        const row = document.querySelector('[data-testid="pending-change-actions"]');
        const hint = row.querySelector('p');
        const withdraw = row.querySelector('button');
        return {
          viewport: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          card: box(card), hint: hint && box(hint), withdraw: withdraw && box(withdraw),
          hintText: hint?.textContent ?? '',
          reachable: (() => { const b = withdraw.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return hit === withdraw || withdraw.contains(hit); })(),
        };
      });
      const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      const got = await measure();
      const label = `${width}px viewport, ${dark ? 'dark' : 'light'}`;
      assert.equal(got.viewport, width, `${label}: the page is not laid out at ${width}px`);
      assert.ok(got.hint && got.withdraw, `${label}: the unlinked hint and Withdraw must both render`);
      assert.ok(got.hintText.includes('cannot offer its signing page'), `${label}: this is not the unlinked hint`);
      assert.equal(got.scrollWidth, width, `${label}: page overflows (${got.scrollWidth} > ${width})`);
      for (const [name, b] of [['hint', got.hint], ['Withdraw', got.withdraw]]) {
        assert.ok(b.left >= got.card.left - 0.5 && b.right <= got.card.right + 0.5, `${label}: ${name} runs outside the card (${JSON.stringify(b)})`);
      }
      assert.ok(!overlaps(got.hint, got.withdraw), `${label}: hint and Withdraw overlap`);
      assert.ok(got.reachable, `${label}: Withdraw is covered`);
      if (width <= 414) {
        assert.ok(got.withdraw.top >= got.hint.bottom - 0.5, `${label}: Withdraw should drop below the wrapped hint`);
        // Prove the browser sees the defect: take the wrap away and the row must overflow or overlap.
        const mutant = await page.addStyleTag({ content: '[data-testid="pending-change-actions"] { flex-wrap: nowrap !important; } [data-testid="pending-change-actions"] > p { flex: none !important; white-space: nowrap !important; }' });
        const m = await measure();
        assert.ok(m.scrollWidth > width || m.withdraw.right > m.card.right + 0.5 || overlaps(m.hint, m.withdraw), `${label}: no-wrap mutant must break the row`);
        await mutant.evaluate((el) => el.remove());
      }
      console.log(JSON.stringify({ width, dark, scrollWidth: got.scrollWidth, hint: got.hint, withdraw: got.withdraw }));
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
