/**
 * portal#1585 (QA P2, Celine + Gemma's correction) — a failed memories read
 * must reach the picker as a FAILURE, never as an empty list.
 * portal#1588 (QA F2, Celine at 3d2c9c546) — the failure must arrive as a
 * VALUE, not a rejection: a streamed rejection fires an uncaught pageerror
 * during kit's parse-time stream deserialization, BEFORE any component can
 * attach a handler (the page-level markStreamHandled catch could not prevent
 * it, 4/4 in real Chromium).
 *
 * Both task-page loaders once caught the node-picker memories stream and
 * resolved it to `[]`, so the failure copy was unreachable from any real
 * route: a 500 on the memories read rendered "No memories found", posing
 * "you can read nothing" as "there is nothing". Then (#1585) they re-threw —
 * reachable, but rejecting (#1588's pageerror). Now they resolve a
 * MemoriesRead: {kind:'failed'} when the read fails.
 *
 * These pins hold the LOADERS to that: nodeMemories RESOLVES to
 * {kind:'failed'} on a failed read (and the page itself still loads — the
 * read degrades the picker, not the page).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASK_DETAIL_QUERY, MEMORIES_QUERY } from '$lib/server/queries';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const task = { id: 'hrn:agenttask:acme.com:team:AT1', appId: 'app-1', status: 'PENDING' };
const emptyCandidates = { workers: [], people: [], peopleWithheld: false, peopleFailed: false, roles: [], families: [] };

// The only two reads that matter here: the task's facts resolve, the
// memories read fails. Everything else the loaders call is stubbed below.
const request = vi.fn(async (q: string) => {
  if (q === AGENT_TASK_DETAIL_QUERY) return { agentTask: task };
  if (q === MEMORIES_QUERY) throw new Error('memories read failed (500)');
  return {};
});
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

vi.mock('$lib/server/agent-tasks', () => ({
  loadTasksApp: async () => app,
  loadWriteCandidates: async () => emptyCandidates,
  loadTree: async () => [],
  loadHistory: async () => [],
  loadReview: async () => ({ kind: 'ok', value: { readiness: null, seat: null } }),
  loadAncestors: async () => ({ ancestors: [], truncated: false }),
  canonicalTaskId: (id: string) => id,
  canonicalTaskRef: async () => ({ appId: 'app-1', taskId: 'AT1' }),
  loadReferences: async () => [],
}));
vi.mock('$lib/server/task-planning', () => ({ taskDependencies: async () => [], taskClonesPage: async () => ({ kind: 'ok', value: { items: [], total: 0, hasMore: false } }) }));

beforeEach(() => {
  request.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const locals = { token: 't', user: { id: 'u1', name: 'U' }, impersonation: undefined };

describe('a failed node-picker memories read is a failure value, not an empty list (#1585, #1588 QA F2)', () => {
  it('tasks/new: nodeMemories resolves {kind:"failed"} when the memories read fails — the page still loads', async () => {
    const { load } = await import('./new/+page.server');
    const result = (await load({ params: { appId: 'app-1' }, locals, url: new URL('https://x/') } as never)) as {
      app: typeof app;
      nodeMemories: Promise<{ kind: string }>;
    };
    expect(result.app.id).toBe('app-1');
    await expect(result.nodeMemories).resolves.toEqual({ kind: 'failed' });
  });

  // portal#2261: the task page no longer reads memories at load; the sections endpoint reads them when the node picker opens.
  it('tasks/[taskId] sections: memories answer {kind:"failed"} (a value, status 200) when the read fails', async () => {
    const { GET } = await import('./[taskId]/sections/+server');
    const r = (await GET({ params: { appId: 'app-1', taskId: 'AT1' }, locals, url: new URL('https://x/sections?section=memories') } as never)) as Response;
    expect(await r.json()).toEqual({ kind: 'failed' });
  });

  it('a failed read warns server-side (the log is the only trace — nothing rejects anywhere)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warn.mockClear(); // the beforeEach spy is the same mock; earlier tests' loads warned into it
    const { load } = await import('./new/+page.server');
    const result = (await load({ params: { appId: 'app-1' }, locals, url: new URL('https://x/') } as never)) as {
      nodeMemories: Promise<{ kind: string }>;
    };
    await result.nodeMemories; // the warn sits in the stream's rejection arm
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('node-picker memory list failed');
  });
});

// portal#1588 QA F2 follow-up: an impersonation session writes nothing, so
// it reads no memory list either — both loaders gate the SAME read the same
// way (the detail loader's rule, adopted by tasks/new). The list page it
// renders has no editor, so the fan-out could never be consumed.
describe('an impersonation session reads no memory list (#1588 QA F2)', () => {
  const impersonating = { token: 't', user: { id: 'u1', name: 'U' }, impersonation: { id: 'i1' } };

  it('tasks/new: nodeMemories resolves an empty ok and MEMORIES_QUERY is never sent', async () => {
    const { load } = await import('./new/+page.server');
    const result = (await load({ params: { appId: 'app-1' }, locals: impersonating, url: new URL('https://x/') } as never)) as {
      nodeMemories: Promise<{ kind: string; value?: unknown[] }>;
    };
    await expect(result.nodeMemories).resolves.toEqual({ kind: 'ok', value: [] });
    expect(request.mock.calls.some(([q]) => q === MEMORIES_QUERY)).toBe(false);
  });

  it('tasks/[taskId] sections: the same gate — no MEMORIES_QUERY for an impersonated viewer', async () => {
    const { GET } = await import('./[taskId]/sections/+server');
    const r = (await GET({ params: { appId: 'app-1', taskId: 'AT1' }, locals: impersonating, url: new URL('https://x/sections?section=memories') } as never)) as Response;
    expect(await r.json()).toEqual({ kind: 'ok', value: [] });
    expect(request.mock.calls.some(([q]) => q === MEMORIES_QUERY)).toBe(false);
  });
});
