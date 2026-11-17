// portal#2201: real AgentChat + compiled CSS, synthetic one-chat/two-message API.
// Read the route's actual wrapper rather than maintaining a second height rule.
// No provider calls, no auth; independent QA also checks the signed-in route.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const source = await readFile('src/routes/app/apps/[appId]/+page.svelte', 'utf8');
const branchAt = source.indexOf('{#if data.selectedChatKey === AGENT_CHAT_KEY}');
assert(branchAt >= 0, 'Agent chat branch not found');
const wrapper = source.slice(branchAt).match(/<div class="([^"]*)" style="([^"]*)">/);
assert(wrapper && wrapper[1].includes('flex-col'), 'Agent chat route wrapper not found');
// #2201's content-box bounds; short desktop is a same-fixture equality guard,
// not a new minimum-height requirement. The last phone leg simulates less
// visible height, without claiming a physical Safari/toolbar test.
const cases = [
  { width: 320, height: 568, minContent: 120 },
  { width: 360, height: 640, minContent: 120 },
  { width: 390, height: 844, minContent: 181, unchanged: true },
  { width: 948, height: 900, minContent: 330, unchanged: true },
  { width: 1366, height: 657, minContent: 0, unchanged: true },
  { width: 320, height: 460, minContent: 120 },
];
const shots = process.env.AGENT_CHAT_SHOTS;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'height-probe-navigation', enforce: 'pre',
  transform(code, id) {
    return /AgentChat\.svelte$/.test(id) ? code.replace("from '$app/navigation'", "from '$lib/test/stubs/app-navigation'") : null;
  },
}] });

// Used for both the floor-on measurement and the same-fixture baseline. Start
// at the message so an unrelated scrollable descendant cannot be mistaken for
// the transcript. This function runs in Chromium and has no outer dependencies.
function measure(el) {
  let scroller = el.parentElement;
  while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  if (!scroller) throw Error('Transcript scroller missing');
  const s = getComputedStyle(scroller), box = scroller.getBoundingClientRect(), msg = el.getBoundingClientRect();
  const composer = document.querySelector('textarea').getBoundingClientRect();
  const nested = [];
  for (let a = scroller.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    if (['auto', 'scroll'].includes(getComputedStyle(a).overflowY) && a.scrollHeight > a.clientHeight) nested.push(a.tagName);
  }
  return {
    panel: document.getElementById('chat-wrapper').getBoundingClientRect().height,
    scroller: scroller.clientHeight,
    content: scroller.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom),
    latestVisible: msg.top >= box.top && msg.bottom <= box.bottom && msg.bottom <= composer.top,
    latestInViewport: msg.top >= 0 && msg.bottom <= innerHeight,
    composerInViewport: composer.top >= 0 && composer.bottom <= innerHeight,
    textarea: composer.height,
    overflow: document.documentElement.scrollWidth > innerWidth,
    nested,
    coarse: matchMedia('(pointer: coarse)').matches,
    fine: matchMedia('(pointer: fine)').matches,
  };
}
let browser;
const results = [];
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  assert(css.length > 1000);
  browser = await chromium.launch({ headless: true });
  if (shots) await mkdir(shots, { recursive: true });
  for (const { width, height, minContent, unchanged } of cases) {
    for (const dark of [false, true]) for (const coarse of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: coarse });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('requestfailed', r => errors.push(`${r.url()}: ${r.failure()?.errorText}`));
        await page.route('**/__height_fixture*', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Chat transcript height</title>' }));
        await page.goto(new URL('/__height_fixture', origin).href);
        await page.evaluate(({ css, dark, cls, style }) => {
          const sheet = document.createElement('style'); sheet.textContent = css; document.head.append(sheet);
          document.documentElement.classList.toggle('dark', dark);
          document.body.className = 'bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
          // Default app shell from src/routes/app/+layout.svelte: keep the nav,
          // collapsed-menu opener and gutters in sync. Author/QA real-route
          // checks are independent of this manually modeled shell.
          document.body.innerHTML = `<div class="flex gap-4 px-4 py-8 sm:gap-8 sm:px-6">
            <aside class="w-48 shrink-0 hidden sm:flex">Nav</aside>
            <button class="self-start rounded-md border p-2 sm:hidden" aria-label="Expand menu"><svg width="16" height="16"></svg></button>
            <div class="min-w-0 flex-1">
            <div id="chat-wrapper" class="${cls}" style="${style}"><div id="panel" class="flex-1 min-h-0 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden"></div></div></div></div>`;
        }, { css, dark, cls: wrapper[1], style: wrapper[2] });
        await page.evaluate(async () => {
          const { mountAgentChat } = await import('/src/lib/test/fixtures/agent-chat-phone-harness.ts');
          window.__chat = mountAgentChat(document.getElementById('panel'), { transcriptHeight: true });
        });
        await page.locator('[data-chat-row]').click();
        const latest = page.getByText('Yes, let’s plan the next session.', { exact: true });
        await latest.waitFor();
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        // Short phones intentionally scroll the document. Prove both the latest
        // message and composer can actually fit in the visible viewport, rather
        // than inferring that from a full-page screenshot.
        await page.locator('textarea').scrollIntoViewIfNeeded();
        const m = await latest.evaluate(measure);
        const label = `${width}x${height}/${dark ? 'dark' : 'light'}/${coarse ? 'coarse' : 'fine'}`;
        console.log(label, JSON.stringify(m));
        results.push({ label, ...m });
        assert(m.content >= minContent, `${label}: transcript content is ${m.content}px`);
        assert(m.latestVisible && m.latestInViewport, `${label}: latest message clipped or off-screen`);
        assert(m.composerInViewport, `${label}: composer off-screen`);
        assert.equal(m.coarse, coarse, `${label}: coarse media mismatch`);
        assert.equal(m.fine, !coarse, `${label}: fine media mismatch`);
        assert.equal(m.textarea, 58, `${label}: composer height changed`);
        assert.equal(m.overflow, false, `${label}: horizontal overflow`);
        assert.deepEqual(m.nested, [], `${label}: added scrolling ancestor`);
        if (unchanged) {
          // Same fixture with the added floor disabled. 390 and 948's tall legs
          // guard future floors above their existing heights; the short desktop
          // also catches an unscoped floor that would grow its panel today.
          await page.locator('#chat-wrapper').evaluate(el => { el.style.minHeight = '0px'; });
          const before = await latest.evaluate(measure);
          await page.locator('#chat-wrapper').evaluate(el => { el.style.removeProperty('min-height'); });
          assert.deepEqual({ panel: m.panel, scroller: m.scroller }, { panel: before.panel, scroller: before.scroller }, `${label}: main layout changed`);
        }
        if (width === 948) assert.equal(m.panel, 620);
        assert(await page.getByLabel('AI config').isVisible(), `${label}: AI config hidden`);
        assert(await page.getByRole('button', { name: 'Send', exact: true }).isVisible(), `${label}: Send hidden`);
        assert.deepEqual(errors, [], `${label}: browser diagnostics`);
        if (shots) {
          await page.screenshot({ path: `${shots}/${label.replaceAll('/', '-')}-viewport.png` });
          await page.screenshot({ path: `${shots}/${label.replaceAll('/', '-')}.png`, fullPage: true });
        }
      } finally { await context.close(); }
    }
  }
  console.log(JSON.stringify(results, null, 2));
} finally { await browser?.close(); await server.close(); }
