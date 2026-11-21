/**
 * portal#2376 — the task page's two cap notes (ambiguous in the issue: partial availability, not a failure)
 * are persistent LiveRegions (before / during / after).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { pinRegion } from '$lib/test/pinStatusRegion';
import TaskPage from './[taskId]/+page.svelte';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const holger = { id: 'u1', kind: 'USER' as const, name: 'Holger', urn: null };
const dara = { id: 'w-dara', kind: 'WORKER' as const, name: 'Dara', urn: 'hrn:worker:acme.com:team:dara' };
const task = (over: Record<string, unknown> = {}) => ({
  id: 't1', handle: 'AT3', appId: 'app-1', parentTaskId: null, title: 'Ship it', status: 'STARTED', queued: false, waitingOnChildren: false,
  source: null, owner: holger, assignee: dara, startBy: null, createdAt: '2026-10-15T10:00:00Z', updatedAt: null, tags: [],
  description: null, requirements: null, createdBy: null, createdByRunId: null, assignedAt: null, assignedBy: null, startedAt: null,
  finishedAt: null, cancelledAt: null, closeSessionWhenDone: false, result: null, sessionEndRequest: null, ...over,
});
const tree = (capped: boolean) => ({ kind: 'ok', value: { rows: [task()], capped } });
const data = (over: Record<string, unknown> = {}) => ({
  app, task: task(), ancestors: [], ancestorsTruncated: false, canWrite: true, impersonating: null, created: false, viewerId: 'u1',
  tree: tree(false), ...over,
});

beforeEach(() => {
  // No IntersectionObserver: every deferred section reads at once, from the stub below.
  vi.stubGlobal('IntersectionObserver', undefined);
});
const mounted: Mounted<Record<string, unknown>>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.unstubAllGlobals(); });

describe('task page cap notes', () => {
  it('the subtree is capped at 1000 tasks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ kind: 'failed' }) })));
    const props = reactiveProps<Record<string, unknown>>({ data: data() });
    const m = mountComponent(TaskPage as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(8);
    const d = props.data as Record<string, unknown>;
    await pinRegion({ root: m.target, text: 'Showing the first 1000 tasks in this tree', settle: () => tick(2),
      raise: () => { props.data = { ...d, tree: tree(true) }; }, clear: () => { props.data = { ...d, tree: tree(false) }; } });
  });

  it('the history is capped at 1000 events', async () => {
    // The history section reads its answer once shown; a re-read (the page's version moves) replaces it in place.
    let capped = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => (new URL(url, 'http://x').searchParams.get('section') === 'history' ? { kind: 'ok', value: { capped, events: [] } } : { kind: 'failed' }),
    })));
    const props = reactiveProps<Record<string, unknown>>({ data: data() });
    const m = mountComponent(TaskPage as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(10);
    expect(m.target.textContent).not.toContain('Loading history…');
    const d = props.data as Record<string, unknown>;
    const reread = async (next: boolean) => { capped = next; props.data = { ...d, task: task({ updatedAt: String(Math.random()) }) }; await tick(10); };
    await pinRegion({ root: m.target, text: 'Showing the first 1000 events', settle: () => tick(10),
      raise: () => reread(true), clear: () => reread(false) });
  });
});
