/**
 * portal#1585 (QA P2, Celine + Gemma's correction) — a failed memories read
 * must reach the picker as a FAILURE, never as an empty list.
 *
 * Both task-page loaders caught the node-picker memories stream and resolved
 * it to `[]`, so the editor's {:catch} arm — the one thing that says WHY the
 * stage is empty (SelectNode's memoriesFailed copy) — was unreachable from
 * any real route: a 500 on the memories read rendered "No memories found",
 * posing "you can read nothing" as "there is nothing". The component pins fed
 * a rejecting stream straight in, which is why they stayed green.
 *
 * These pins hold the LOADERS to the gate: the returned nodeMemories promise
 * REJECTS when the read fails (and the page itself still loads — the stream
 * degrades the picker, not the page).
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
  loadAncestors: async () => ({ ancestors: [], truncated: false }),
  canonicalTaskId: (id: string) => id,
  loadReferences: async () => [],
}));
vi.mock('$lib/server/task-planning', () => ({ taskDependencies: async () => [] }));

beforeEach(() => {
  request.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const locals = { token: 't', user: { id: 'u1', name: 'U' }, impersonation: undefined };

describe('a failed node-picker memories read is a failure, not an empty list (#1585)', () => {
  it('tasks/new: nodeMemories rejects when the memories read fails — the page still loads', async () => {
    const { load } = await import('./new/+page.server');
    const result = (await load({ params: { appId: 'app-1' }, locals, url: new URL('https://x/') } as never)) as {
      app: typeof app;
      nodeMemories: Promise<unknown[]>;
    };
    expect(result.app.id).toBe('app-1');
    await expect(result.nodeMemories).rejects.toThrow('memories read failed');
  });

  it('tasks/[taskId]: nodeMemories rejects when the memories read fails — the page still loads', async () => {
    const { load } = await import('./[taskId]/+page.server');
    const result = (await load({ params: { appId: 'app-1', taskId: 'AT1' }, locals, url: new URL('https://x/') } as never)) as {
      task: typeof task;
      nodeMemories: Promise<unknown[]>;
    };
    expect(result.task.id).toContain('AT1');
    await expect(result.nodeMemories).rejects.toThrow('memories read failed');
  });
});

// portal#1588 QA F2 follow-up: an impersonation session writes nothing, so
// it reads no memory list either — both loaders gate the SAME read the same
// way (the detail loader's rule, adopted by tasks/new). The list page it
// renders has no editor, so the fan-out could never be consumed.
describe('an impersonation session reads no memory list (#1588 QA F2)', () => {
  const impersonating = { token: 't', user: { id: 'u1', name: 'U' }, impersonation: { id: 'i1' } };

  it('tasks/new: nodeMemories resolves empty and MEMORIES_QUERY is never sent', async () => {
    const { load } = await import('./new/+page.server');
    const result = (await load({ params: { appId: 'app-1' }, locals: impersonating, url: new URL('https://x/') } as never)) as {
      nodeMemories: Promise<unknown[]>;
    };
    await expect(result.nodeMemories).resolves.toEqual([]);
    expect(request.mock.calls.some(([q]) => q === MEMORIES_QUERY)).toBe(false);
  });

  it('tasks/[taskId]: the same gate — no MEMORIES_QUERY on an impersonated load', async () => {
    const { load } = await import('./[taskId]/+page.server');
    const result = (await load({ params: { appId: 'app-1', taskId: 'AT1' }, locals: impersonating, url: new URL('https://x/') } as never)) as {
      nodeMemories: Promise<unknown[]>;
    };
    await expect(result.nodeMemories).resolves.toEqual([]);
    expect(request.mock.calls.some(([q]) => q === MEMORIES_QUERY)).toBe(false);
  });
});
