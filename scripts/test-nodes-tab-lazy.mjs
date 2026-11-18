// portal#1700: the restored Nodes tab on bounded reads, in real Chromium with the compiled app.css.
// The two doors are answered from a deterministic 30k-shaped fixture (3,000 top-level nodes, each
// with 9 children, plus a node-less branch that only the Table reaches). What it pins that jsdom
// cannot: one request per user action, a mounted-row count that stays bounded as pages accumulate,
// no horizontal overflow at 390px, and no memoryNodes/memoryEdges/graph read, light and dark.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:nodes-tab-lazy
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const MEM = 'mem-30k';
const RELOADED = /Execution context was destroyed|navigation/i;
const TOP = 3000;
const KIDS = 9;
const node = (loc, i) => ({ id: `id:${loc}`, loc, name: `Node ${i}`, description: null, nodeType: 'info', tags: [], memoryId: MEM, memory: { id: MEM, urn: 'hrn:mem:fixture.test:m', name: 'M' } });
const TABLE_TOTAL = TOP * (KIDS + 1);
const topLoc = (i) => `t${String(i).padStart(5, '0')}`;
// Table order: every top node then its kids; 30,000 rows in all, the last one a node-less `ghost:` row (inside the declared count, so a drain reaches it).
const tableRow = (n) => (n < TABLE_TOTAL - 1 ? (n % (KIDS + 1) === 0 ? node(topLoc(n / (KIDS + 1)), n) : node(`${topLoc(Math.floor(n / (KIDS + 1)))}:k${n % (KIDS + 1)}`, n)) : node(`ghost:deep:g${n}`, n));


function page(rows, size, offset, count) {
  const slice = [];
  for (let i = offset; i < Math.min(count, offset + size + 1); i++) slice.push(rows(i));
  return { rows: slice.slice(0, size), hasMore: slice.length > size };
}

async function answer(route, requests) {
  const url = new URL(route.request().url());
  requests.push(url.pathname.replace(/^.*\/nodes\//, '') + url.search);
  const offset = Number(url.searchParams.get('offset'));
  let body;
  if (url.pathname.endsWith('/nodes/page')) body = page(tableRow, 50, offset, TABLE_TOTAL);
  else {
    const parent = url.searchParams.get('parent') ?? '';
    body = parent === ''
      ? page((i) => node(topLoc(i), i), 20, offset, TOP)
      : page((i) => node(`${parent}:k${i + 1}`, i), 20, offset, KIDS);
  }
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
}

async function mountOnce(page, origin, css, pane) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>nodes</title>' }));
      await page.goto(new URL('/__blank', origin).href);
      await page.evaluate(([css, pane]) => {
        document.head.innerHTML = '';
        try { localStorage.setItem('hadron:memoryBrowser:nodesPane', pane); } catch {}
        document.body.innerHTML = `<style>${css}</style><main id="col" style="max-width:960px;margin:0 auto;padding:0 16px"></main>`;
      }, [css, pane]);
      await page.evaluate(async (mem) => {
        const { mountLazyNodes } = await import('/src/lib/test/fixtures/lazy-nodes-harness.ts');
        mountLazyNodes(document.getElementById('col'), mem);
      }, MEM);
      return;
    } catch (e) {
      if (attempt >= 5 || !RELOADED.test(String(e))) throw e;
    }
  }
}

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });

  for (const width of [390, 1280]) {
    for (const scheme of ['light', 'dark']) {
      const label = `${width}px ${scheme}`;
      for (const pane of ['table', 'tree']) {
        const p = await browser.newPage({ viewport: { width, height: 844 } });
        const requests = [];
        const forbidden = [];
        p.on('request', (r) => { if (/memoryNodes|memoryEdges|\/graph|graphql/i.test(r.url()) || /memoryNodes|memoryEdges/.test(r.postData() ?? '')) forbidden.push(r.url()); });
        await p.route('**/nodes/page*', (route) => answer(route, requests));
        await p.route('**/nodes/children*', (route) => answer(route, requests));
        await mountOnce(p, origin, css, pane);
        await p.evaluate((dark) => {
          document.documentElement.classList.toggle('dark', dark);
          document.documentElement.style.background = document.body.style.background = dark ? '#09090b' : '#fafafa';
        }, scheme === 'dark');

        if (pane === 'table') {
          await p.waitForSelector('table tbody tr');
          assert.deepEqual(requests, ['page?offset=0'], `${label} table: first paint is exactly one bounded page (${requests})`);
          for (let i = 1; i <= 5; i++) {
            await p.click('button:has-text("Load more nodes")');
            await p.waitForFunction((n) => /\b(\d+) loaded/.test(document.body.innerText) && Number(/(\d+) loaded/.exec(document.body.innerText)[1]) >= n, 50 * (i + 1));
          }
          assert.deepEqual(requests, ['page?offset=0', 'page?offset=50', 'page?offset=100', 'page?offset=150', 'page?offset=200', 'page?offset=250'], `${label} table: one read per click`);
          const rows = await p.locator('table tbody tr').count();
          assert.ok(rows <= 60, `${label} table: ${rows} mounted rows after 300 loaded (must stay a page, not the list)`);
        } else {
          await p.waitForSelector('[data-testid="tree-node"]');
          assert.deepEqual(requests, ['children?parent=&offset=0'], `${label} tree: first paint is exactly one top-level page (${requests})`);
          for (let i = 1; i <= 30; i++) {
            await p.evaluate(() => { const s = document.querySelector('[data-testid="tree-scroller"]'); s.scrollTop = s.scrollHeight; });
            await p.waitForSelector('button:has-text("Load more nodes")');
            await p.click('button:has-text("Load more nodes")');
            await p.waitForFunction((n) => document.querySelector('[data-testid="tree-list"]').style.height === `${n * 32}px`, 20 * (i + 1) + 1);
          }
          const mounted = await p.locator('[data-testid="tree-node"]').count();
          assert.ok(mounted < 80, `${label} tree: ${mounted} mounted rows after 620 loaded (windowed, not drained)`);
          assert.equal(requests.length, 31, `${label} tree: one request per Load more nodes (${requests.length})`);
          // A folder opens its children with one read.
          await p.evaluate(() => { document.querySelector('[data-testid="tree-scroller"]').scrollTop = 0; });
          await p.click('button[aria-label="Expand"]');
          await p.waitForSelector('a[title^="t00000:k"]');
          assert.ok(requests.at(-1).startsWith('children?parent=t00000&offset=0'), `${label} tree: folder read (${requests.at(-1)})`);
        }
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 0, `${label} ${pane}: horizontal overflow ${overflow}px`);
        assert.deepEqual(forbidden, [], `${label} ${pane}: no memoryNodes/memoryEdges/graph read`);
        await p.close();
        console.log(`ok ${label} ${pane}: ${requests.length} bounded reads, no overflow`);
      }
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
