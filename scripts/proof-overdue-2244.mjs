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
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname: paths with spaces or a Windows host break on
// the raw pathname (portal#2248 review P3).
const OUT = fileURLToPath(new URL('../docs/proofs/tasks-overdue-2244/', import.meta.url));
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

async function shoot(name, { dark, savedArrangement = null }) {
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
  // portal#2253 item 4: optionally seed a saved board arrangement (pre-PR
  // vintage, saved before the Finish by column existed) BEFORE the board
  // mounts, the way a real browser carries it in localStorage across a
  // deploy. The mount-time migration must weave the unseen column in at its
  // default position rather than appending it at the far end.
  if (savedArrangement) {
    await page.evaluate((entries) => {
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
    }, savedArrangement);
  }
  await page.evaluate(async () => { await import('/src/lib/test/fixtures/task-board-mount.ts'); });
  await page.evaluate(async (initial) => {
    window.__h = await window.__mountBoard(initial);
  }, initial);
  // Not a fixed sleep loop (portal#2248 review P3): wait for the table.
  await page.waitForSelector('tbody tr');

  // Scoped to the one header row (portal#2253 item 3): header indexes map onto
  // td indexes, and a second header row or a th in tbody would skew the mapping.
  const headers = await page.$$eval('thead tr:last-child th', (ths) => ths.map((th) => (th.textContent || '').trim()));
  if (!headers.some((h) => h.startsWith('Finish by'))) throw new Error(`${name}: no Finish by column: ${JSON.stringify(headers)}`);
  // portal#2248 review P3: both deadline columns fully inside the 1440
  // viewport — a date cut mid-value at the table edge fails the ask
  // ("a reader can tell which time passed"). This binds the DEFAULT
  // arrangement only (the unseeded legs): a seeded arrangement is by
  // construction a dragged one, and where the user drags their deadlines is
  // their choice, not a clip the app caused (portal#2274 P3 follow-on: the
  // dragged seed puts Finish by past 1440 by the width of the people columns
  // dragged ahead of it).
  if (!savedArrangement) {
    const fold = await page.$$eval('thead tr:last-child th', (ths) => ths.map((th) => {
      const r = th.getBoundingClientRect();
      return { text: (th.textContent || '').trim(), right: r.right };
    }));
    for (const prefix of ['Start by', 'Finish by']) {
      const h = fold.find((x) => x.text.startsWith(prefix));
      if (!h) throw new Error(`${name}: "${prefix}" column missing`);
      if (h.right > 1440) throw new Error(`${name}: "${prefix}" column is cut by the 1440 viewport edge (right=${Math.round(h.right)})`);
    }
  }
  // portal#2253 item 4, seeded leg only: the migration must have woven the
  // unseen Finish by column in right after Start by (its default home), not
  // appended it at the far end where the fold check above would fail it.
  if (savedArrangement) {
    const startByIdx = headers.findIndex((h) => h.startsWith('Start by'));
    const finishByIdx = headers.findIndex((h) => h.startsWith('Finish by'));
    // Absence must fail HERE: the fold check above no longer covers the
    // seeded leg, and without this assert a missing Start by (-1) passes the
    // adjacency vacuously (-1 + 1 === 0 matches Finish by at 0) — portal#2274 P3.
    if (startByIdx < 0) throw new Error(`${name}: "Start by" column missing: ${JSON.stringify(headers)}`);
    if (finishByIdx !== startByIdx + 1) {
      throw new Error(`${name}: saved arrangement did not migrate (Finish by at ${finishByIdx}, Start by at ${startByIdx}): ${JSON.stringify(headers)}`);
    }
  }
  // portal#2248 review: the mark is task-level, in the Status cell — never
  // under Start by ("— overdue" pointed at the one arm a started task can
  // never be on) and never under Finish by alone. Asserted on the mark hook
  // (data-testid="overdue-mark"), not row text, so a title can never fake a
  // mark or hide a missing one.
  const statusIdx = headers.findIndex((h) => h.startsWith('Status'));
  const startByIdx = headers.findIndex((h) => h.startsWith('Start by'));
  const titleIdx = headers.findIndex((h) => h.startsWith('Task'));
  if (statusIdx < 0 || startByIdx < 0 || titleIdx < 0) throw new Error(`${name}: Status, Task or Start by column missing: ${JSON.stringify(headers)}`);
  const rows = await page.$$eval('tbody tr',
    (trs, ti) => trs.map((tr) => {
      const tds = [...tr.querySelectorAll('td')];
      const mark = tr.querySelector('[data-testid=overdue-mark]');
      return {
        title: ((tds[ti]?.textContent) || '').trim(),
        // -1 when the row carries no mark; the index of the td that carries it
        markCell: mark ? tds.indexOf(mark.closest('td')) : -1,
      };
    }), titleIdx);
  if (rows.length !== 4) throw new Error(`${name}: expected 4 rows, got ${rows.length}`);
  const marked = rows.filter((r) => r.markCell >= 0);
  if (marked.length !== 2) throw new Error(`${name}: expected exactly 2 overdue marks, got ${marked.length}: ${JSON.stringify(rows)}`);
  // The board sorts by Updated desc, so align by title, not by row index.
  for (const t of tasks) {
    const key = t.title.split(' — ')[0];
    const row = rows.find((r) => r.title.startsWith(key));
    if (!row) throw new Error(`${name}: fixture row "${key}" not found on the board: ${JSON.stringify(rows.map((r) => r.title))}`);
    if (row.markCell === startByIdx) throw new Error(`${name}: "${t.title}" carries the mark under Start by (cell ${row.markCell}): ${JSON.stringify(rows)}`);
    if (t.overdue !== (row.markCell === statusIdx)) {
      throw new Error(`${name}: "${t.title}" mark is not in the Status cell (cell ${row.markCell}, status col ${statusIdx}): ${JSON.stringify(rows)}`);
    }
  }
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: false });
  results.push({ name, rows: rows.length, overdueMarks: marked.length, finishByColumn: true });
  await page.evaluate(() => window.__h.unmount());
  await context.close();
}

// try/finally (portal#2248 review P3): a failed assertion must not
// leave the vite server and the browser to process-exit cleanup.
// The third leg (portal#2253 item 4) seeds a saved arrangement saved before
// the Finish by column existed — the people columns dragged AHEAD of the
// deadlines, matching the client test's seed — and proves the migration
// places the column at its default home on a real layout. The seed must be a
// visibly dragged order: the earlier seed merged back to exactly the default
// arrangement, so the screenshot could not distinguish "migrated" from "no
// saved view at all" (portal#2274 P3).
const savedArrangement = {
  'hadron:views:v1:app-tasks:board': JSON.stringify([{
    id: 'v1', listKey: 'app-tasks:board', name: 'Pre-2248 layout',
    view: {
      sorting: [{ id: 'updated', desc: true }], columnFilters: [], globalFilter: '',
      columnVisibility: { created: false, tags: false, id: false },
      columnOrder: ['status', 'title', 'priority', 'owner', 'assignee', 'subtasks', 'startBy', 'updated'],
      columnSizing: {}, pagination: { pageIndex: 0, pageSize: 25 },
    },
    isDefault: true, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  }]),
  'hadron:views:v1:active:app-tasks:board': 'v1',
};
try {
  await shoot('1440-light-board', { dark: false });
  await shoot('1440-dark-board', { dark: true });
  await shoot('1440-light-board-saved-arrangement', { dark: false, savedArrangement });
  console.log(JSON.stringify(results, null, 1));
} finally {
  await browser.close();
  await server.close();
}
