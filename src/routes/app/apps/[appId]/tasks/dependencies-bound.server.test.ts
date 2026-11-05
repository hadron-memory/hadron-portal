/**
 * portal#1392 — the task page's blocker relations are an OPTIONAL read: a
 * relation request that never answers must not hold the page, whose core facts
 * are already loaded. Both the detail loader and the paging endpoint bound the
 * wait with the shared OPTIONAL_LIST_TIMEOUT_MS budget and settle to the
 * existing {kind:'failed'} state ("unavailable, reload to try again"), never
 * to empty relations. withTimeout stops the WAIT; it does not abort the
 * request, and nothing here claims it does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASK_DETAIL_QUERY, AGENT_TASK_REF_QUERY, AGENT_TASKS_APP_QUERY, MEMORIES_QUERY, TASK_BLOCKED_BY_PAGE_QUERY, TASK_DEPENDENCIES_QUERY } from '$lib/server/queries';
import { OPTIONAL_LIST_TIMEOUT_MS } from '$lib/server/with-timeout';
import { load } from './[taskId]/+page.server';
import { GET } from './[taskId]/relations/+server';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const task = { id: 'hrn:agenttask:acme.com:team:AT1', appId: 'app-1', status: 'PENDING', parentTaskId: null };
const page = { items: [], hasMore: false };
const held = () => new Promise<never>(() => {});
let relations: () => Promise<unknown>;
const request = vi.fn(async (q: string) => {
  if (q === AGENT_TASKS_APP_QUERY) return { app };
  if (q === AGENT_TASK_REF_QUERY) return { agentTask: { id: task.id, appId: app.id } };
  if (q === AGENT_TASK_DETAIL_QUERY) return { agentTask: task };
  if (q === MEMORIES_QUERY) return { memories: [] };
  if (q === TASK_DEPENDENCIES_QUERY || q === TASK_BLOCKED_BY_PAGE_QUERY) return relations();
  return {};
});
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
vi.mock('$lib/server/agent-tasks', () => ({
  loadTasksApp: async () => app,
  loadWriteCandidates: async () => ({ workers: [], people: [], peopleWithheld: false, peopleFailed: false, roles: [], families: [] }),
  loadTree: async () => [],
  loadHistory: async () => [],
  loadReview: async () => ({ kind: 'ok', value: { readiness: null, seat: null } }),
  loadAncestors: async () => ({ ancestors: [], truncated: false }),
  canonicalTaskId: async (_c: unknown, _a: string, id: string) => id,
}));

beforeEach(() => { vi.useFakeTimers(); request.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

/** Start `work`, then report whether it has settled after `ms` of fake time. */
async function settledAfter<T>(work: Promise<T>, ms: number) {
  let value: T | undefined; let done = false;
  void work.then((v) => { value = v; done = true; });
  await vi.advanceTimersByTimeAsync(ms);
  return { done, value };
}
const detailLoad = () => load({ params: { appId: 'app-1', taskId: 'AT1' }, locals: { token: 't', user: { id: 'u1' } }, url: new URL('https://x/') } as never) as Promise<{ task: typeof task; dependencies: unknown }>;
const pageGet = () => Promise.resolve(GET({ locals: { token: 't' }, params: { appId: 'app-1', taskId: 'AT1' }, url: new URL('https://x/relations?direction=blockedBy&offset=200') } as never));

describe('a held relation read cannot hold the task page (portal#1392)', () => {
  it('the detail page loads its facts with relations unknown once the optional budget runs out', async () => {
    relations = held;
    const work = detailLoad();
    expect((await settledAfter(work, OPTIONAL_LIST_TIMEOUT_MS - 1)).done).toBe(false);
    const after = await settledAfter(work, 1);
    expect(after.done).toBe(true);
    expect(after.value).toMatchObject({ task: { id: task.id }, dependencies: { kind: 'failed' } });
  });
  it('control: relations that answer inside the budget are served unchanged', async () => {
    relations = async () => ({ agentTask: { id: task.id, appId: app.id, blockedBy: page, blocks: page } });
    const { done, value } = await settledAfter(detailLoad(), 0);
    expect(done).toBe(true);
    expect(value).toMatchObject({ dependencies: { kind: 'ok', value: { blockedBy: page, blocks: page } } });
  });
  it('a held Load-more page answers unknown, never an empty page, once the budget runs out', async () => {
    relations = held;
    const work = pageGet();
    expect((await settledAfter(work, OPTIONAL_LIST_TIMEOUT_MS - 1)).done).toBe(false);
    const after = await settledAfter(work, 1);
    expect(after.done).toBe(true);
    expect(after.value!.headers.get('cache-control')).toBe('no-store');
    expect(await after.value!.json()).toEqual({ kind: 'failed' });
  });
});
