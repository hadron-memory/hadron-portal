// portal#2201: real AgentChat + compiled CSS, synthetic one-chat/two-message API.
// Read the route's actual wrapper rather than maintaining a second height rule.
// No provider calls, no auth; independent browser QA also checks the signed-in route.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const source = await readFile('src/routes/app/apps/[appId]/+page.svelte', 'utf8');
const branch = source.slice(source.indexOf('{#if data.selectedChatKey === AGENT_CHAT_KEY}'));
const wrapper = branch.match(/<div class="([^"]*)" style="([^"]*)">/);
assert(wrapper, 'Agent chat route wrapper not found');
const shots = process.env.AGENT_CHAT_SHOTS;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'height-probe-navigation', enforce: 'pre',
  transform(code, id) {
    return /AgentChat\.svelte$/.test(id) ? code.replace("from '$app/navigation'", "from '$lib/test/stubs/app-navigation'") : null;
  },
}] });
let browser;
const results = [];
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  assert(css.length > 1000);
  browser = await chromium.launch({ headless: true });
  if (shots) await mkdir(shots, { recursive: true });
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [948, 900]]) {
    for (const dark of [false, true]) for (const coarse of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: coarse });
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
        document.body.innerHTML = `<div class="flex gap-4 px-4 py-8 sm:gap-8 sm:px-6">
          <aside class="w-48 shrink-0 hidden sm:flex">Nav</aside><div class="min-w-0 flex-1">
          <div id="chat-wrapper" class="${cls}" style="${style}"><div id="panel" class="flex-1 min-h-0 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden"></div></div></div></div>`;
      }, { css, dark, cls: wrapper[1], style: wrapper[2] });
      await page.evaluate(async () => {
        const { mountAgentChat } = await import('/src/lib/test/fixtures/agent-chat-phone-harness.ts');
        window.__chat = mountAgentChat(document.getElementById('panel'), { transcriptHeight: true });
      });
      await page.locator('[data-chat-row]').click();
      const latest = page.getByText('Yes, let’s plan the next session.', { exact: true });
      await latest.waitFor();
      // Let AgentChat's after-flush scroll-to-tail finish before measuring it.
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const m = await latest.evaluate(el => {
        let scroller = el.parentElement;
        while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
        if (!scroller) throw Error('Transcript scroller missing');
        const s = getComputedStyle(scroller), box = scroller.getBoundingClientRect(), msg = el.getBoundingClientRect();
        const composer = document.querySelector('textarea').getBoundingClientRect();
        return {
          panel: document.getElementById('chat-wrapper').getBoundingClientRect().height,
          scroller: scroller.clientHeight,
          content: scroller.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom),
          latestVisible: msg.top >= box.top && msg.bottom <= box.bottom && msg.bottom <= composer.top,
          textarea: composer.height,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      const label = `${width}x${height}/${dark ? 'dark' : 'light'}/${coarse ? 'coarse' : 'fine'}`;
      console.log(label, JSON.stringify(m));
      results.push({ label, ...m });
      assert(m.content >= (width === 390 ? 181 : width === 948 ? 330 : 120), `${label}: transcript content is ${m.content}px`);
      assert(m.latestVisible, `${label}: latest message clipped`);
      assert.equal(m.textarea, 58, `${label}: composer height changed`);
      assert.equal(m.overflow, false, `${label}: horizontal overflow`);
      if (width === 948) { assert.equal(m.panel, 620); assert.equal(m.scroller, 362); }
      assert(await page.getByLabel('AI config').isVisible(), `${label}: AI config hidden`);
      assert(await page.getByRole('button', { name: 'Send', exact: true }).isVisible(), `${label}: Send hidden`);
      assert.deepEqual(errors, [], `${label}: browser diagnostics`);
      if (shots) await page.screenshot({ path: `${shots}/${label.replaceAll('/', '-')}.png`, fullPage: true });
      await context.close();
    }
  }
  console.log(JSON.stringify(results, null, 2));
} finally { await browser?.close(); await server.close(); }
