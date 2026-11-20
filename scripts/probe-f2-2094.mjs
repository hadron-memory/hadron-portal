// One-off probe for BLIND F2 (portal#2171): what the 104px composer floor
// costs the transcript when a small phone's viewport shrinks (keyboard open).
// Untracked scratch — never committed. Run: node scripts/probe-f2-2094.mjs
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = '/home/orca/scratch/gravitus/f2-evidence';
await mkdir(OUT, { recursive: true });

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
await server.listen();
const origin = `http://127.0.0.1:${server.config.server.port}`;
const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
const browser = await chromium.launch({ headless: true });

async function open(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route('**/__chat_fixture*', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Agent chat fixture</title>' }));
  await page.goto(new URL('/__chat_fixture', origin).href);
  await page.evaluate((css) => {
    document.head.innerHTML += `<style>${css}</style>`;
    document.body.className = 'bg-zinc-50 text-zinc-900';
    // The same app shell the layout harness uses (calc(100dvh - 280px)).
    document.body.innerHTML = `<div class="flex gap-4 px-4 py-8 sm:gap-8 sm:px-6">
      <aside class="w-48 shrink-0 flex-col hidden sm:flex"><nav>Nav</nav></aside>
      <div class="min-w-0 flex-1">
        <div class="flex flex-col" style="height: calc(100vh - 280px); height: calc(100dvh - 280px);">
          <div id="panel" class="flex-1 min-h-0 rounded-lg border border-zinc-200 border-zinc-800 overflow-hidden"></div>
        </div></div></div>`;
  }, css);
  await page.evaluate(async () => {
    const { mountAgentChat } = await import('/src/lib/test/fixtures/agent-chat-phone-harness.ts');
    window.__chat = mountAgentChat(document.getElementById('panel'), {});
  });
  await page.locator('[data-chat-row]').first().waitFor({ state: 'attached' });
  // DOM click: at small panel heights the row can sit under the fold, and the
  // point here is measuring the OPEN conversation, not the list's reachability.
  await page.evaluate(() => document.querySelector('[data-chat-row="chats:a"]').click());
  await page.getByText('Which weeks work best').waitFor();
  return page;
}

for (const height of [568, 380, 300]) {
  const page = await open(320, height);
  const m = await page.evaluate(() => {
    const main = document.querySelector('#panel main');
    const boxes = [...main.children].map((el) => {
      const r = el.getBoundingClientRect();
      return `${el.tagName}.${(el.getAttribute('class') ?? '').split(' ').slice(0, 2).join('.')}: h=${Math.round(r.height)}`;
    });
    const ta = main.querySelector('textarea');
    const transcript = [...main.querySelectorAll('*')].find((el) => el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY === 'auto');
    return {
      viewport: `${innerWidth}x${innerHeight}`,
      panel: Math.round(document.getElementById('panel').getBoundingClientRect().height),
      mainChildren: boxes,
      taMin: getComputedStyle(ta).minHeight,
      taBox: Math.round(ta.getBoundingClientRect().height),
      transcript: transcript ? {
        h: Math.round(transcript.getBoundingClientRect().height),
        scrollH: transcript.scrollHeight,
        clips: transcript.scrollHeight > transcript.clientHeight + 1,
      } : null,
      pageScrolls: document.documentElement.scrollWidth > innerWidth,
      docScrolls: document.documentElement.scrollHeight > innerHeight,
    };
  });
  console.log(`\n=== 320x${height} (light, conversation) ===`);
  console.log(JSON.stringify(m, null, 1));
  await page.screenshot({ path: `${OUT}/320x${height}-conversation.png`, fullPage: false });
  await page.close();
}

await browser.close();
await server.close();
console.log(`\nshots in ${OUT}`);
