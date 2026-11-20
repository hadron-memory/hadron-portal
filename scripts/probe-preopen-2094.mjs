import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'stub', enforce: 'pre', transform(code, id) {
    return /AgentChat\.svelte$/.test(id) ? code.replace("from '$app/navigation'", "from '$lib/test/stubs/app-navigation'") : null; } }],
});
await server.listen();
const origin = `http://127.0.0.1:${server.config.server.port}`;
const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 800 } });
await page.route('**/__chat_fixture*', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>f</title>' }));
await page.goto(new URL('/__chat_fixture', origin).href);
await page.evaluate((css) => {
  document.head.innerHTML += `<style>${css}</style>`;
  document.body.innerHTML = `<div class="flex gap-4 px-4 py-8 sm:gap-8 sm:px-6"><aside class="w-48 shrink-0 flex-col hidden sm:flex"><nav>Nav</nav></aside><div class="min-w-0 flex-1"><div class="flex flex-col" style="height: calc(100vh - 280px);"><div id="panel" class="flex-1 min-h-0 rounded-lg border border-zinc-200 overflow-hidden"></div></div></div></div>`;
}, css);
await page.evaluate(async () => {
  const { mountAgentChat } = await import('/src/lib/test/fixtures/agent-chat-phone-harness.ts');
  window.__chat = mountAgentChat(document.getElementById('panel'), {});
});
await page.locator('[data-chat-row]').first().waitFor({ state: 'attached' });
const pre = await page.evaluate(() => {
  const all = [...document.querySelectorAll('#panel main textarea')];
  return {
    count: all.length,
    enabledCount: document.querySelectorAll('#panel main textarea:not([disabled])').length,
    disabledAttr: all.map((t) => t.hasAttribute('disabled')),
    placeholder: all.map((t) => t.placeholder),
  };
});
console.log('PRE-OPEN at 1024:', JSON.stringify(pre, null, 1));
await browser.close();
await server.close();
