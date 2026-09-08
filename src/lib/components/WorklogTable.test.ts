/**
 * The worklog grid, SSR.
 *
 * Converted from a hand-rolled `<table>`. These pin the three #733 rules the
 * conversion could silently have dropped — they are the reason this stays ONE
 * component used by both the App and the Worker page:
 *
 *   1. render the denormalized `workerName`, never a join through `workerId`;
 *   2. never dedupe the per-ref fan-out — several sessions on one artifact IS
 *      the answer the worklog is asked for;
 *   3. list a record whose session is unreadable BY ID rather than dropping it.
 *
 * Plus the empty state, which must not unmount the grid chrome.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

// SvelteKit virtuals, absent without the SvelteKit plugin
// (hrn:node:hadronmemory.com:hadron-portal:conventions:vitest-mocks-sveltekit-virtuals).
vi.mock('$app/stores', () => ({
  page: {
    subscribe: (fn: (v: unknown) => void) => (fn({ url: new URL('http://x/'), data: {} }), () => {}),
  },
}));
vi.mock('$app/navigation', () => ({ goto: () => {}, invalidate: () => {} }));

import WorklogTable, { worklogSearchExtras } from './WorklogTable.svelte';
import { makeGlobalFilterFn } from '$lib/table/global-filter';
import type { TeamWorkItem } from '$lib/types';

function item(over: Partial<TeamWorkItem> = {}): TeamWorkItem {
  return {
    nodeId: 'node-1',
    sessionId: 'sess-abc',
    workerName: 'Gil',
    workerId: 'worker-1',
    tool: 'github',
    kind: 'pr',
    ref: 'hadron-memory/hadron-portal#819',
    action: 'merged',
    at: '2026-09-06T08:00:00.000Z',
    detail: null,
    ...over,
  } as TeamWorkItem;
}

function body(items: TeamWorkItem[], props: Record<string, unknown> = {}) {
  return render(WorklogTable, {
    props: { items, total: items.length, listKey: 'test:worklog', ...props } as never,
  }).body;
}

/** Just the row body — the Columns toggle repeats every column name in chrome. */
function rows(items: TeamWorkItem[], props: Record<string, unknown> = {}): string {
  const html = body(items, props);
  const open = html.indexOf('<tbody');
  expect(open).toBeGreaterThan(-1);
  return html.slice(open, html.indexOf('</tbody>'));
}

describe('WorklogTable', () => {
  it('renders as a TanStack grid, not a hand-rolled table', () => {
    const html = body([item()]);
    expect(html).toContain('<table');
    expect(html).toMatch(/Search these records/i);
    // The saved-view strip is the chrome the bespoke table had none of.
    expect(html).toMatch(/New view/i);
  });

  it('renders the denormalized workerName', () => {
    // Correct for a RETIRED worker and for pre-#974 records, both of which a
    // live join through workerId would lose.
    expect(rows([item({ workerName: 'Dara' })])).toContain('Dara');
  });

  it('badges an unattributed record without inventing a reason', () => {
    // A null workerId does NOT say why. An earlier badge said "pre-worker",
    // which labelled a human's own record as an old worker.
    const html = rows([item({ workerId: null, workerName: 'holger' })]);
    expect(html).toContain('holger');
    expect(html).toMatch(/no worker/i);
    expect(html).not.toMatch(/pre-worker/i);
  });

  it('never dedupes the per-ref fan-out, and labels it', () => {
    // Several worker sessions on one artifact is the FEATURE.
    const shared = 'hadron-memory/hadron-portal#819';
    const html = rows([
      item({ nodeId: 'n1', sessionId: 's1', ref: shared }),
      item({ nodeId: 'n2', sessionId: 's2', ref: shared }),
    ]);
    expect(html.split('s1').length - 1).toBeGreaterThan(0);
    expect(html).toContain('s2');
    expect(html).toMatch(/2 worker sessions/);
  });

  it('shows the session id even when the session is unreadable', () => {
    // A record that exists must not vanish from the provenance chain just
    // because its session is out of reach.
    expect(rows([item({ sessionId: 'sess-unreadable' })])).toContain('sess-unreadable');
  });

  it('keeps the empty state ABOVE a still-mounted grid', () => {
    // Unmounting the table takes ViewTabs with it, and ViewTabs' mount
    // re-applies the active saved view — so a view whose filter matches nothing
    // would remove the only controls that could change it
    // (hrn:node:hadronmemory.com:hadron-portal:review:saved-view-arrangement-not-position).
    const html = body([]);
    expect(html).toMatch(/No work records yet/i);
    expect(html).toContain('<table');
    expect(html).toMatch(/New view/i);
  });

  it('distinguishes a load failure from an empty worklog', () => {
    const html = body([], { loadError: true });
    expect(html).toMatch(/loading failure, not an empty worklog/i);
    expect(html).not.toMatch(/No work records yet/i);
    // No grid on an error: there is no data to arrange, and a saved view cannot
    // strand a reader on a banner.
    expect(html).not.toContain('<table');
  });

  it('offers the server-side filters only when asked', () => {
    // Off on the worker page, where the WORKER is already the filter.
    expect(body([item()], { showFilters: true })).toMatch(/owner\/repo#123/);
    expect(body([item()], { showFilters: false })).not.toMatch(/owner\/repo#123/);
  });
});

describe('the cell renders text the accessor never sees (@codex on #819)', () => {
  it('renders the no-worker badge', () => {
    expect(rows([item({ workerId: null, workerName: 'holger' })])).toMatch(/no worker/i);
  });

  it('FINDS an unattributed record by that badge — through the real filter', () => {
    const filter = makeGlobalFilterFn<TeamWorkItem>({}, worklogSearchExtras(() => new Map()));
    const unattributed = { getValue: () => 'holger', original: item({ workerId: null }) };
    const attributed = { getValue: () => 'Gil', original: item() };
    expect(filter(unattributed, 'workerName', 'no worker')).toBe(true);
    // And the other direction: an attributed record must NOT match it.
    expect(filter(attributed, 'workerName', 'no worker')).toBe(false);
  });
});

describe('the Artifact cell renders two things its accessor does not (@codex on #819)', () => {
  // Swept rather than patched: @codex reported the TITLE, and the same cell also
  // renders the fan-out label ("3 worker sessions"), which is the answer the
  // worklog exists to give. Both were missing; only one was reported.
  const withTitle = item({
    ref: 'owner/repo#7',
    detail: { title: 'Fix the flaky reaper test' },
  } as Partial<TeamWorkItem>);

  it('renders the title, and finds the row by it', () => {
    expect(rows([withTitle])).toContain('Fix the flaky reaper test');
    const filter = makeGlobalFilterFn<TeamWorkItem>({}, worklogSearchExtras(() => new Map()));
    const r = { getValue: () => 'owner/repo#7', original: withTitle };
    expect(filter(r, 'ref', 'flaky reaper')).toBe(true);
    expect(filter(r, 'ref', 'nothing-like-this')).toBe(false);
  });

  it('finds a fanned-out row by the label that marks the fan-out', () => {
    const counts = new Map([['owner/repo#7', 3]]);
    const filter = makeGlobalFilterFn<TeamWorkItem>({}, worklogSearchExtras(() => counts));
    const r = { getValue: () => 'owner/repo#7', original: withTitle };
    expect(filter(r, 'ref', '3 worker sessions')).toBe(true);
  });

  it('adds no fan-out text for a single-session artifact', () => {
    // The label is not rendered for one session, so it must not be searchable
    // either — a row that does not say "worker sessions" must not match it.
    const filter = makeGlobalFilterFn<TeamWorkItem>({}, worklogSearchExtras(() => new Map()));
    const r = { getValue: () => 'owner/repo#7', original: item({ ref: 'owner/repo#7' }) };
    expect(filter(r, 'ref', 'worker sessions')).toBe(false);
  });
});
