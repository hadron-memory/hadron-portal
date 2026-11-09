// #1558: real hydrated Invite component, synthetic successful action + form seam.
// No account/backend journey, invitation creation, email or OS permission claim.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright';
const shots = process.env.INVITE_COPY_SHOTS;
if (shots) await mkdir(shots, { recursive: true });
const alias = { $lib: resolve('src/lib'),
  'sveltekit-superforms/adapters': resolve('src/lib/test/fixtures/invite-copy-forms.ts'),
  'sveltekit-superforms': resolve('src/lib/test/fixtures/invite-copy-forms.ts') };
const server = await createServer({ configFile: false, plugins: [tailwindcss(), svelte()],
  resolve: { alias, dedupe: ['svelte'], conditions: ['browser'] },
  optimizeDeps: { noDiscovery: true }, server: { host: '127.0.0.1', port: 0 } });
// The single source of the fixture URL (#1742): the script owns the value and
// passes it into the harness mount, so the expected writes below can never
// drift from what the fixture rendered.
const INVITE_URL = 'https://example.test/invite/qa-synthetic';
const REPLACEMENT_URL = 'https://example.test/invite/new-link';
const unavailable = 'Copy is unavailable. Select the link and copy it manually.';
const rejected = 'Could not copy the link. Select the link and copy it manually.';
const WIDTHS = [1280, 390];
const THEMES = ['light', 'dark'];
const MODES = ['missing', 'rejected', 'resolved', 'replacement', 'roundtrip', 'destroyed'];
const TOTAL = WIDTHS.length * THEMES.length * MODES.length;
const failures = [];
let browser;
let count = 0;
// Deterministic settling (#1742), replacing the old waitForTimeout(30) probes:
// releaseCopy resolves the pending write and marks copySettledAt two microtask
// turns later — after the component's `await` continuation and Svelte's
// microtask flush have both run. settlePaint() then waits two animation
// frames, so a negative "did NOT appear" assertion is bounded by event-loop
// order, never by wall-clock luck. Unknown clipboard errors still fail loudly.
const settlePaint = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
try {
  await server.listen(); const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });
  for (const width of WIDTHS) for (const theme of THEMES) {
    for (const mode of MODES) {
      const label = `${width}-${theme}-${mode}`;
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(2500);
      const requests = [];
      try {
        await page.route('**/__invite_copy', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Invite copy</title><main id="fixture"></main>' }));
        await page.goto(new URL('/__invite_copy', origin).href);
        await page.evaluate(({ css, theme, mode }) => {
          document.documentElement.classList.toggle('dark', theme === 'dark');
          document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);
          document.body.style.cssText = `padding:16px;background:${theme === 'dark' ? '#09090b' : '#fafafa'}`;
          window.writes = []; window.rejections = []; window.pageErrors = []; window.copySettledAt = null;
          window.addEventListener('unhandledrejection', e => { window.rejections.push(String(e.reason)); e.preventDefault(); });
          window.addEventListener('error', e => window.pageErrors.push(e.message));
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'missing' ? undefined : {
            writeText(text) {
              window.writes.push(text);
              if (mode === 'rejected' || window.rejectNext) return Promise.reject(new DOMException('Synthetic refusal', 'NotAllowedError'));
              return new Promise(resolve => {
                window.releaseCopy = () => {
                  resolve();
                  queueMicrotask(() => queueMicrotask(() => { window.copySettledAt = window.writes.length; }));
                };
              });
            },
          } });
        }, { css, theme, mode });
        await page.evaluate(async (url) => {
          const h = await import('/src/lib/test/fixtures/invite-copy-harness.ts');
          window.fixture = h.mountInviteCopy(document.getElementById('fixture'), url);
        }, INVITE_URL);
        await page.waitForLoadState('networkidle');
        // Count ALL requests after hydration, not just POST. Copy is local only.
        page.on('request', request => requests.push({ method: request.method(), url: request.url() }));
        const copy = page.getByRole('button', { name: 'Copy invitation link', exact: true });
        assert.equal((await copy.textContent())?.trim(), 'Copy', `${label}: visible Copy label retained under the specific name`);
        await copy.focus(); await page.keyboard.press('Enter');
        if (mode === 'missing') await page.getByText(unavailable, { exact: true }).waitFor();
        else if (mode === 'rejected') await page.getByText(rejected, { exact: true }).waitFor();
        else {
          await page.waitForFunction(() => window.writes.length === 1);
          assert.equal(await copy.evaluate(el => el === document.activeElement), true, `${label}: pending Copy keeps keyboard focus`);
          assert.equal(await page.getByText('Link copied.', { exact: true }).count(), 0, `${label}: pending is not success`);
          assert.equal(await page.getByRole('button', { name: 'Copy invitation link' }).getAttribute('aria-disabled'), 'true', `${label}: pending is announced disabled`);
          await copy.evaluate(el => el.click());
          assert.equal(await page.evaluate(() => window.writes.length), 1, `${label}: no duplicate pending write`);
          if (mode === 'replacement') await page.evaluate(url => window.fixture.replace(url), REPLACEMENT_URL);
          if (mode === 'roundtrip') {
            await page.evaluate(url => window.fixture.replace(url), REPLACEMENT_URL);
            await page.evaluate(url => window.fixture.replace(url), INVITE_URL);
          }
          if (mode === 'destroyed') await page.evaluate(() => window.fixture.destroy());
          await page.evaluate(() => window.releaseCopy());
          if (mode === 'resolved') {
            await page.getByText('Link copied.', { exact: true }).waitFor();
            assert.equal(await copy.evaluate(el => el === document.activeElement), true, `${label}: resolved Copy keeps keyboard focus`);
            assert.match(await page.getByRole('status').textContent(), /Link copied\./);
            assert.equal(await page.getByRole('status').getAttribute('aria-live'), 'polite');
            if (shots) await page.screenshot({ path: `${shots}/${label}-success.png`, fullPage: true });
            await page.evaluate(() => { window.rejectNext = true; });
            await copy.click();
            await page.getByText(rejected, { exact: true }).waitFor();
            assert.equal(await page.getByText('Link copied.', { exact: true }).count(), 0, `${label}: later failure replaces success`);
          } else if (mode === 'replacement') {
            await page.waitForFunction(() => window.copySettledAt === 1);
            await settlePaint(page);
            assert.equal(await page.getByText('Link copied.', { exact: true }).count(), 0, `${label}: stale completion ignored`);
            // #1742: a fresh Copy after replacement must write the REPLACEMENT
            // value — not the URL the invalidated attempt captured.
            await copy.click();
            await page.waitForFunction((replacement) => window.writes.length === 2 && window.writes[1] === replacement, REPLACEMENT_URL);
            await page.evaluate(() => window.releaseCopy());
            await page.waitForFunction(() => window.copySettledAt === 2);
            await page.getByText('Link copied.', { exact: true }).waitFor();
          } else {
            await page.waitForFunction(() => window.copySettledAt === 1);
            await settlePaint(page);
            assert.equal(await page.getByText('Link copied.', { exact: true }).count(), 0, `${label}: stale completion ignored`);
          }
        }
        if (mode !== 'destroyed') {
          const link = page.getByRole('textbox', { name: 'Invitation link', exact: true });
          await link.focus();
          assert.equal(await link.evaluate(el => el === document.activeElement), true);
          const expected = mode === 'replacement' ? REPLACEMENT_URL : INVITE_URL;
          assert.equal(await link.inputValue(), expected);
          assert.equal(await link.evaluate(el => {
            el.select();
            return el.value.slice(el.selectionStart, el.selectionEnd);
          }), expected, `${label}: full link remains selectable`);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label}: no horizontal overflow`);
        }
        if (mode === 'resolved') {
          // Emulate engines without field-sizing. A long origin must remain
          // manually scrollable, rather than hide its final wrapped lines.
          const longUrl = `https://portal.staging.example-hadron-memory.com/invite/${'long-origin-control-'.repeat(16)}`;
          await page.evaluate(url => window.fixture.replace(url), longUrl);
          const fallback = page.getByRole('textbox', { name: 'Invitation link', exact: true });
          await fallback.evaluate(el => { el.style.setProperty('field-sizing', 'fixed'); el.scrollTop = 0; });
          assert.equal(await fallback.evaluate(el => el.scrollHeight > el.clientHeight), true, `${label}: fallback exercises overflow`);
          await fallback.hover();
          await page.mouse.wheel(0, 600);
          await page.waitForFunction(() => document.querySelector('textarea[readonly]').scrollTop > 0);
          assert.equal(await fallback.inputValue(), longUrl, `${label}: fallback retains complete link`);
        }
        await settlePaint(page);
        const state = await page.evaluate(() => ({ writes: window.writes, rejections: window.rejections, errors: window.pageErrors }));
        assert.deepEqual(state.writes, mode === 'missing' ? [] : mode === 'resolved' ? [INVITE_URL, INVITE_URL] : mode === 'replacement' ? [INVITE_URL, REPLACEMENT_URL] : [INVITE_URL]);
        assert.deepEqual(state.rejections, [], `${label}: handled rejection`);
        assert.deepEqual(state.errors, [], `${label}: no page error`);
        assert.deepEqual(requests, [], `${label}: zero Copy-initiated requests including POST`);
        if (shots && mode !== 'destroyed') await page.screenshot({ path: `${shots}/${label}.png`, fullPage: true });
        console.log(`ok ${label}`); count++;
      } catch (error) {
        failures.push(`${label}: ${String(error).split('\n')[0]}`);
        console.error(failures.at(-1));
        console.error(JSON.stringify({ ...await page.evaluate(() => ({ writes: window.writes, rejections: window.rejections })).catch(() => ({})), requests }));
      } finally { await page.close(); }
    }
  }
} finally { await browser?.close(); await server.close(); }
assert.deepEqual(failures, [], `${count} passed; ${failures.length} failed`);
console.log(`${count}/${TOTAL} Invite clipboard browser cases passed; real component, controlled clipboard, zero writes to server.`);
