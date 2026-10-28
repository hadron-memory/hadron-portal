/**
 * #919 — the profile Workers grid, SSR, plus its state and search helpers.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('$app/stores', () => ({
  page: { subscribe: (fn: (v: unknown) => void) => (fn({ url: new URL('http://x/'), data: {} }), () => {}) },
}));
vi.mock('$app/navigation', () => ({ goto: () => {}, invalidate: () => {} }));

import HeldWorkersTable, { heldWorkerRoleLabel, heldWorkerSearchExtras, heldWorkerState, heldWorkerStateLabel, type HeldWorker } from './HeldWorkersTable.svelte';
import { makeGlobalFilterFn } from '$lib/table/global-filter';

const w = (over: Partial<HeldWorker> = {}): HeldWorker => ({
  id: 'w1', name: 'Dara', urn: 'hrn:worker:acme.com:team:dara', role: 'server-engineer',
  appId: 'app-1', appUrn: 'hrn:app:acme.com:team', heldAt: '2026-09-20T10:00:00Z',
  hasLiveSession: true, lastActiveAt: '2026-09-25T10:00:00Z', ...over,
});

describe('heldWorkerState — live, idle, never, or masked', () => {
  it('marks a live session active, whatever else is true', () => {
    expect(heldWorkerState(w())).toBe('active');
    expect(heldWorkerStateLabel(w())).toBe('Active now');
  });

  it('says when an idle worker last had recorded activity', () => {
    const idle = w({ hasLiveSession: false, lastActiveAt: '2026-09-24T09:00:00Z' });
    expect(heldWorkerState(idle)).toBe('idle');
    expect(heldWorkerStateLabel(idle)).toContain('Last recorded activity');
  });

  it('tells no-recorded-activity apart from idle', () => {
    expect(heldWorkerState(w({ hasLiveSession: false, lastActiveAt: null }))).toBe('never');
  });

  it('treats a MASKED state (null) as unknown, never as idle or never-driven', () => {
    const masked = w({ hasLiveSession: null, lastActiveAt: null });
    expect(heldWorkerState(masked)).toBe('unknown');
    // In words, perceivable without hover (@codex on #930).
    expect(heldWorkerStateLabel(masked)).toBe('Not shown to you');
  });
});

describe('HeldWorkersTable — rendered', () => {
  const body = render(HeldWorkersTable, {
    props: {
      workers: [
        w(),
        w({ id: 'w2', name: 'Eli', urn: null, role: null, appUrn: null, hasLiveSession: false, lastActiveAt: '2026-09-24T09:00:00Z' }),
      ],
    },
  }).body;

  it('links each worker to its page and marks the live one', () => {
    expect(body).toContain('href="/app/workers/w1"');
    expect(body).toContain('data-testid="held-worker-active"');
    expect(body).toContain('Active now');
    expect(body).toContain('Last recorded activity');
  });

  it('shows the App and worker URNs as linked chips, and a dash, never an empty chip, when absent', () => {
    expect(body).toContain('/app/u/hrn:app:acme.com:team');
    expect(body).toContain('/app/u/hrn:worker:acme.com:team:dara');
    expect(body).toContain('No role');
  });

  it('shows a MASKED state as visible text, not a hover-only dash (@codex on #930)', () => {
    const masked = render(HeldWorkersTable, { props: { workers: [w({ hasLiveSession: null, lastActiveAt: null })] } }).body;
    expect(masked).toMatch(/data-testid="held-worker-masked"[^>]*>Not shown to you</);
    expect(masked).not.toContain('title="Not shown to you"');
  });

  it('names each chip\'s copy buttons for what they copy (@codex on #930)', () => {
    expect(body).toContain('aria-label="Copy App URN"');
    expect(body).toContain('aria-label="Copy worker URN"');
    expect(body).not.toContain('aria-label="Copy URN"');
  });
});

describe('HeldWorkersTable — search finds what the cells show', () => {
  const filter = makeGlobalFilterFn<HeldWorker>({ state: () => '', heldAt: () => '' }, heldWorkerSearchExtras);
  const row = (worker: HeldWorker, columnId: string) =>
    ({ original: worker, getValue: () => (columnId === 'state' ? 0 : ''), getAllCells: () => [] }) as never;

  it('finds a live worker by "Active now"', () => {
    expect(filter(row(w(), 'state'), 'state', 'active now')).toBe(true);
  });

  it('does not find an idle worker by "Active now"', () => {
    expect(filter(row(w({ hasLiveSession: false }), 'state'), 'state', 'active now')).toBe(false);
  });
});

describe('HeldWorkersTable — the "No role" it renders is searchable (@codex on #930)', () => {
  const filter = makeGlobalFilterFn<HeldWorker>({ state: () => '', heldAt: () => '' }, heldWorkerSearchExtras);
  const row = (worker: HeldWorker) => ({ original: worker, getValue: () => '', getAllCells: () => [] }) as never;

  it('finds a role-less worker by "No role", and not one with a role', () => {
    expect(heldWorkerRoleLabel(w({ role: null }))).toBe('No role');
    expect(filter(row(w({ role: null })), 'role', 'no role')).toBe(true);
    expect(filter(row(w()), 'role', 'no role')).toBe(false);
  });
});

describe('HeldWorkersTable — names are App-qualified in this cross-App list (@codex on #930)', () => {
  it('renders two same-named workers from different Apps as distinct', () => {
    const body = render(HeldWorkersTable, {
      props: {
        workers: [
          w({ id: 'a', name: 'Iris', appUrn: 'hrn:app:acme.com:eng-team' }),
          w({ id: 'b', name: 'Iris', appUrn: 'hrn:app:acme.com:sales-team' }),
        ],
      },
    }).body;
    expect(body).toContain('eng-team/Iris');
    expect(body).toContain('sales-team/Iris');
  });
});
