/**
 * The worker page's "Worker sessions" grid, SSR.
 *
 * Converted from a bespoke `<ul>`. These pin the things the conversion could
 * silently lose: the three lifecycle states staying distinct, the
 * forward-looking expiry badge, and the columns actually reaching the markup.
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

import WorkerSessionsTable, { sessionSearchExtras } from './WorkerSessionsTable.svelte';
import { makeGlobalFilterFn } from '$lib/table/global-filter';
import type { WorkerSession } from '$lib/types';

function session(over: Partial<WorkerSession> = {}): WorkerSession {
  return {
    id: 'sess-1',
    type: 'DEVELOPER',
    repo: 'hadron-memory/hadron-portal',
    branch: 'main',
    tool: 'claude-code',
    host: 'mac-01',
    llmModel: 'claude-opus-5',
    plan: 'Convert the worker lists to TanStack',
    summary: 'Landed the conversion',
    prNumber: 819,
    turnCount: 12,
    errorCount: 0,
    startedAt: '2026-09-06T08:00:00.000Z',
    endedAt: '2026-09-06T09:00:00.000Z',
    expiresAt: null,
    autoExpiredAt: null,
    transcriptPath: '/Users/holger/.claude/transcripts/sess-1.jsonl',
    ...over,
  };
}

const body = (sessions: WorkerSession[]) =>
  render(WorkerSessionsTable, { props: { sessions } }).body;

/**
 * Just the row body.
 *
 * Necessary, not fussy: the grid chrome contains a Columns toggle listing every
 * column NAME, so a bare `toMatch(/Ended/)` over the whole document matches the
 * "Ended" checkbox label whether or not any row says it. My first version of
 * the expired-vs-ended test asserted over the full markup and failed on correct
 * output for exactly that reason.
 */
function rows(sessions: WorkerSession[]): string {
  const html = body(sessions);
  const open = html.indexOf('<tbody');
  const close = html.indexOf('</tbody>');
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return html.slice(open, close);
}

describe('WorkerSessionsTable', () => {
  it('renders the grid chrome the bespoke list could not offer', () => {
    const html = body([session()]);
    // Search + a real <table> are the point of the conversion.
    expect(html).toContain('<table');
    expect(html).toMatch(/Search worker sessions/i);
  });

  it('renders every field the old row stacked into prose, as columns', () => {
    const html = body([session()]);
    for (const value of [
      'hadron-memory/hadron-portal@main',
      'claude-code',
      'mac-01',
      'claude-opus-5',
      '#819',
      'Convert the worker lists to TanStack',
    ]) {
      expect(html).toContain(value);
    }
  });

  it('keeps EXPIRED distinct from ENDED', () => {
    // The reaper sets endedAt too, so collapsing these would tell a reader
    // somebody chose to stop when the session actually died under them.
    const reaped = rows([session({ autoExpiredAt: '2026-09-06T09:00:00.000Z' })]);
    expect(reaped).toMatch(/Expired/);
    expect(reaped).not.toMatch(/>Ended</);

    const closed = rows([session()]);
    expect(closed).toMatch(/>Ended</);
    expect(closed).not.toMatch(/Expired/);
  });

  it('marks an open session as open', () => {
    const html = rows([session({ endedAt: null, autoExpiredAt: null })]);
    expect(html).toMatch(/>Open</);
  });

  it('warns about an imminent expiry — the only forward-looking signal we show', () => {
    // Every expiry on this team so far was discovered by a write failing.
    const soon = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const html = body([session({ endedAt: null, autoExpiredAt: null, expiresAt: soon })]);
    expect(html).toMatch(/Expires in \d+ min/);
  });

  it('says a past-expiry session is living on borrowed time', () => {
    const past = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const html = body([session({ endedAt: null, autoExpiredAt: null, expiresAt: past })]);
    expect(html).toMatch(/Past its expiry/);
  });

  it('renders the transcript path as plain text, never a link', () => {
    // Host-local, and meaningless to anyone not on that machine.
    const html = body([session()]);
    expect(html).toContain('/Users/holger/.claude/transcripts/sess-1.jsonl');
    expect(html).not.toMatch(/<a[^>]*transcripts\/sess-1/);
  });

  it('renders an em dash for absent optional fields rather than blank cells', () => {
    const html = body([
      session({ plan: null, summary: null, prNumber: null, transcriptPath: null, tool: null }),
    ]);
    expect(html).toContain('—');
  });
});

describe('the cell renders text the accessor never sees (@codex on #819)', () => {
  // A cell snippet can render more than its accessor returns. Anything it adds
  // is visible on screen and invisible to search unless registered as a
  // searchable extra — which is how a reader ends up unable to find the very
  // row they are looking at.
  const soon = () => new Date(Date.now() + 20 * 60 * 1000).toISOString();

  it('renders the expiry warning', () => {
    const html = rows([session({ endedAt: null, autoExpiredAt: null, expiresAt: soon() })]);
    expect(html).toMatch(/Expires in \d+ min/);
  });

  it('FINDS a row by that warning — driven through the real filter', () => {
    // The status ACCESSOR returns only "Open"; the warning lives in the cell.
    // Driving the component's own exported extras, so this fails if the extra
    // is dropped — a regex over the source would not prove the row is found.
    const now = Date.now();
    const s = session({ endedAt: null, autoExpiredAt: null, expiresAt: soon() });
    const filter = makeGlobalFilterFn<WorkerSession>({}, sessionSearchExtras(now));
    const r = { getValue: () => 'Open', original: s };
    expect(filter(r, 'status', 'Expires in')).toBe(true);
    expect(filter(r, 'status', 'nothing-like-this')).toBe(false);
  });

  describe('served prompt column (portal#1665)', () => {
    it('with onServed: one named Show button per session, pressed only for the open one', () => {
      const html = render(WorkerSessionsTable, {
        props: { sessions: [session({ id: 'a' }), session({ id: 'b' })], onServed: () => {}, servedId: 'b' },
      }).body;
      const row = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
      expect(row.match(/Served prompt for the session started/g)).toHaveLength(2);
      expect(row.match(/aria-pressed="true"/g)).toHaveLength(1);
    });

    it('the Show column is right after Started, not off-screen at the end of a 12-column grid', () => {
      const html = body([session()]);
      const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
      expect(head.indexOf('Served prompt')).toBeGreaterThan(-1);
      expect(head.indexOf('Served prompt')).toBeLessThan(head.indexOf('Status'));
      expect(head.indexOf('Served prompt')).toBeGreaterThan(head.indexOf('Started'));
    });

    it('without onServed: no button, just a dash (the column is hidden of actions)', () => {
      const row = rows([session()]);
      expect(row).not.toContain('Served prompt for the session started');
    });
  });
});
