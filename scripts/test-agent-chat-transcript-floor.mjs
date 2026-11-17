// portal#2201: the App agent chat transcript keeps a readable height on short
// phones. Real Chromium, compiled app CSS, the real AgentChat, and the panel
// style imported from src/lib/agent-chat-panel.ts (the formula the page ships).
// Layout is invisible to jsdom, so measured boxes are the acceptance:
// the transcript scroller is the first overflow-y:auto ancestor of the first
// message, and its CONTENT box is the client height minus its own padding.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  plugins: [
    {
      name: 'agent-chat-navigation-stub',
      enforce: 'pre',
      transform(code, id) {
        return /AgentChat\.svelte$/.test(id)
          ? code.replace("from '$app/navigation'", "from '$lib/test/stubs/app-navigation'")
          : null;
      },
    },
  ],
});

const MIN_CONTENT = 120; // the Ask: at 320x568 and 360x640
const FIRST = 'Which weeks work best';
const LAST = 'will use it for the schedule';
const LEGS = [
  { name: '320x568', width: 320, height: 568, min: MIN_CONTENT },
  { name: '360x640', width: 360, height: 640, min: MIN_CONTENT },
  // Guards pinned to this probe's own baseline on main (fixture panel, no real-route
  // extras): 390 must not get worse, 948 must not change at all (portal#2201 acceptance 2, 3).
  { name: '390x844', width: 390, height: 844, min: 272 },
  { name: '948x900', width: 948, height: 900, exact: { content: 343, scroller: 375, panel: 620 } },
];

let browser;
const failures = [];
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  assert(css.length > 1000, 'compiled app.css was not served');
  browser = await chromium.launch({ headless: true });

  for (const dark of [false, true]) {
    for (const leg of LEGS) {
      const label = `${leg.name}/${dark ? 'dark' : 'light'}`;
      const page = await browser.newPage({ viewport: { width: leg.width, height: leg.height } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
      await page.route('**/__chat_fixture*', (r) =>
        r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Agent chat fixture</title>' }),
      );
      for (let attempt = 0; ; attempt++) {
        try {
          await page.goto(new URL('/__chat_fixture', origin).href);
          await page.evaluate(async ({ css, dark }) => {
            const { AGENT_CHAT_PANEL_STYLE } = await import('/src/lib/agent-chat-panel.ts');
            document.head.innerHTML += `<style>${css}</style>`;
            document.documentElement.classList.toggle('dark', dark);
            document.body.className = 'bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
            // The app shell of src/routes/app/+layout.svelte around the App page's panel.
            document.body.innerHTML = `<div class="flex gap-4 px-4 py-8 sm:gap-8 sm:px-6">
              <aside class="w-48 shrink-0 flex-col hidden sm:flex"><nav>Nav</nav></aside>
              <div class="min-w-0 flex-1">
                <div class="flex flex-col" style="${AGENT_CHAT_PANEL_STYLE}">
                  <div id="panel" class="flex-1 min-h-0 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden"></div>
                </div></div></div>`;
          }, { css, dark });
          await page.evaluate(async () => {
            const { mountAgentChat } = await import('/src/lib/test/fixtures/agent-chat-phone-harness.ts');
            window.__chat = mountAgentChat(document.getElementById('panel'), {});
          });
          break;
        } catch (e) {
          if (attempt >= 5 || !/Execution context was destroyed|navigation/i.test(String(e))) throw e;
        }
      }
      await page.locator('[data-chat-row="chats:a"]').first().waitFor({ state: 'attached' });
      const row = page.locator('[data-chat-row="chats:a"]').first();
      if (await row.isVisible()) await row.click();
      await page.getByText(FIRST).waitFor();

      const m = await page.evaluate(({ FIRST, LAST }) => {
        const find = (text) => [...document.querySelectorAll('#panel *')].filter((el) => el.children.length === 0 && el.textContent.includes(text)).pop();
        const first = find(FIRST);
        let scroller = first;
        while (scroller && getComputedStyle(scroller).overflowY !== 'auto') scroller = scroller.parentElement;
        const cs = getComputedStyle(scroller);
        const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        const sr = scroller.getBoundingClientRect();
        // The latest message must be fully visible: scroll the transcript to its end first, as a reader does.
        scroller.scrollTop = scroller.scrollHeight;
        const last = find(LAST).getBoundingClientRect();
        const ta = document.querySelector('#panel main textarea').getBoundingClientRect();
        return {
          panel: Math.round(document.getElementById('panel').getBoundingClientRect().height),
          scroller: Math.round(sr.height),
          content: Math.round(scroller.clientHeight - pad),
          lastVisible: last.height > 0 && last.top >= sr.top - 0.5 && last.bottom <= sr.bottom + 0.5,
          textarea: Math.round(ta.height),
          overflowX: document.documentElement.scrollWidth > innerWidth,
        };
      }, { FIRST, LAST });
      console.log(label, JSON.stringify(m));

      const bad = [];
      if (leg.min !== undefined && m.content < leg.min) bad.push(`content ${m.content}px < ${leg.min}px`);
      if (leg.min === MIN_CONTENT && !m.lastVisible) bad.push('latest message not fully visible');
      if (leg.exact) for (const [k, v] of Object.entries(leg.exact)) if (m[k] !== v) bad.push(`${k} ${m[k]} != ${v}`);
      if (Math.abs(m.textarea - 58) > 2) bad.push(`composer textarea ${m.textarea}px != 58px`);
      if (m.overflowX) bad.push('horizontal page overflow');
      if (errors.length) bad.push(...errors);
      if (bad.length) failures.push(`${label}: ${bad.join('; ')}`);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
assert.deepEqual(failures, [], `transcript floor failures:\n${failures.join('\n')}`);
console.log('transcript floor: ok (320x568, 360x640, 390x844, 948x900; light and dark)');
