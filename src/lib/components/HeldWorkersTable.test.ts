/**
 * #919 — the profile Workers grid, SSR, plus its state and search helpers.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('$app/stores', () => ({
  page: { subscribe: (fn: (v: unknown) => void) => (fn({ url: new URL('http://x/'), data: {} }), () => {}) },
}));
vi.mock('$app/navigation', () => ({ goto: () => {}, invalidate: () => {} }));

import HeldWorkersTable, { heldWorkerSearchExtras, heldWorkerState, heldWorkerStateLabel, type HeldWorker } from './HeldWorkersTable.svelte';
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

  it('says when an idle worker was last driven', () => {
    const idle = w({ hasLiveSession: false, lastActiveAt: '2026-09-24T09:00:00Z' });
    expect(heldWorkerState(idle)).toBe('idle');
    expect(heldWorkerStateLabel(idle)).toContain('Last driven');
  });

  it('tells never-driven apart from idle', () => {
    expect(heldWorkerState(w({ hasLiveSession: false, lastActiveAt: null }))).toBe('never');
  });

  it('treats a MASKED state (null) as unknown, never as idle or never-driven', () => {
    const masked = w({ hasLiveSession: null, lastActiveAt: null });
    expect(heldWorkerState(masked)).toBe('unknown');
    expect(heldWorkerStateLabel(masked)).toBe('');
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
    expect(body).toContain('Last driven');
  });

  it('shows the App and worker URNs as linked chips, and a dash, never an empty chip, when absent', () => {
    expect(body).toContain('/app/u/hrn:app:acme.com:team');
    expect(body).toContain('/app/u/hrn:worker:acme.com:team:dara');
    expect(body).toContain('No role');
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
