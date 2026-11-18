/**
 * portal#2244 browser proofs: the board's overdue mark is the server's
 * `AgentTask.overdue` and nothing else — start-by OR finish-by passed, judged
 * on the server clock — and the finish-by deadline has a column. Screenshots
 * land in docs/proofs/tasks-overdue-2244/ for the PR.
 *
 * Drives the same fixture-mounted page as the client-lane tests
 * (board-overdue.client.test.ts → TaskBoardHarness): the real
 * +page.svelte, no backend, every row exactly as the server returns it.
 * The marks come from the `overdue` booleans alone, so the two overdue rows
 * (one STARTED past finish-by, one PENDING with no start-by past finish-by)
 * carry the mark and the healthy future rows do not — whatever the browser
 * clock would say about their deadlines.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../docs/proofs/tasks-overdue-2244/', import.meta.url).pathname;
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

/** Rows exactly as the server returns them: the four cases the rule has. */
const tasks = [
  {
    id: 'a', handle: 'AT0.1', parentTaskId: null, title: 'Draft the changelog — started, finish-by passed',
    status: 'STARTED', queued: false, waitingOnChildren: false, priority: null, blocked: null, source: null,
    owner: { id: 'u1', kind: 'USER', name: 'Alice', urn: null }, assignee: null,
    startBy: null, finishBy: '2026-11-17T16:00:00Z', overdue: true,
    createdAt: '2026-11-16T09:00:00Z', updatedAt: null, tags: [],
  },
  {
    id: 'b', handle: 'AT0.2', parentTaskId: null, title: 'Index the docs — pending, no start-by, finish-by passed',
    status: 'PENDING', queued: false, waitingOnChildren: false, priority: null, blocked: null, source: null,
    owner: { id: 'u1', kind: 'USER', name: 'Alice', urn: null }, assignee: null,
    startBy: null, finishBy: '2026-11-17T09:00:00Z', overdue: true,
    createdAt: '2026-11-15T09:00:00Z', updatedAt: null, tags: [],
  },
  {
    id: 'c', handle: 'AT0.3', parentTaskId: null, title: 'Plan next week — deadlines ahead',
    status: 'PENDING', queued: false, waitingOnChildren: false, priority: null, blocked: null, source: null,
    owner: { id: 'u1', kind: 'USER', name: 'Alice', urn: null }, assignee: null,
    startBy: '2026-11-20T09:00:00Z', finishBy: '2026-11-21T17:00:00Z', overdue: false,
    createdAt: '2026-11-16T10:00:00Z', updatedAt: null, tags: [],
  },
  {
    id: 'd', handle: 'AT0.4', parentTaskId: null, title: 'Rotate the keys — done',
    status: 'FINISHED', queued: false, waitingOnChildren: false, priority: null, blocked: null, source: null,
    owner: { id: 'u1', kind: 'USER', name: 'Alice', urn: null }, assignee: null,
    startBy: null, finishBy: '2026-11-15T17:00:00Z', overdue: false,
    createdAt: '2026-11-14T09:00:00Z', updatedAt: null, tags: [],
  },
];
const initial = {
  app: { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null },
  view: 'board', filter: 'all', text: '', boardLimit: 200, loadedAt: '2026-11-18T00:00:00Z', impersonating: null,
  board: { kind: 'ok', value: { capped: false, tasks } },
};

const browser = await chromium.launch({ headless: true });
const results = [];

async function shoot(name, { dark }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.route('**/__board_fixture*', (r) => r.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>f</title>`,
  }));
  await page.goto(new URL('/__board_fixture', origin).href);
  await page.addStyleTag({ content: css });
  await page.evaluate((dark) => {
    document.documentElement.classList.toggle('dark', dark);
    document.body.className = 'bg-white dark:bg-zinc-950';
  }, dark);
  await page.evaluate(async () => { await import('/src/lib/test/fixtures/task-board-mount.ts'); });
  await page.evaluate(async (initial) => {
    window.__h = await window.__mountBoard(initial);
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 25));
  }, initial);

  const rows = await page.$$eval('tbody tr', (trs) => trs.map((tr) => tr.textContent || ''));
  if (rows.length !== 4) throw new Error(`${name}: expected 4 rows, got ${rows.length}`);
  const marked = rows.filter((t) => t.includes('overdue'));
  if (marked.length !== 2) throw new Error(`${name}: expected exactly 2 overdue marks, got ${marked.length}: ${JSON.stringify(rows)}`);
  if (!marked[0].includes('Draft the changelog') || !marked[1].includes('Index the docs')) {
    throw new Error(`${name}: the marks are not on the two server-marked rows: ${JSON.stringify(marked)}`);
  }
  if (marked.some((t) => t.includes('Plan next week') || t.includes('Rotate the keys'))) {
    throw new Error(`${name}: a healthy row carries a mark`);
  }
  const headers = await page.$$eval('th', (ths) => ths.map((th) => (th.textContent || '').trim()));
  if (!headers.some((h) => h.startsWith('Finish by'))) throw new Error(`${name}: no Finish by column: ${JSON.stringify(headers)}`);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  results.push({ name, rows: rows.length, overdueMarks: marked.length, finishByColumn: true });
  await page.evaluate(() => window.__h.unmount());
  await context.close();
}

await shoot('1440-light-board', { dark: false });
await shoot('1440-dark-board', { dark: true });

console.log(JSON.stringify(results, null, 1));
await browser.close();
await server.close();
