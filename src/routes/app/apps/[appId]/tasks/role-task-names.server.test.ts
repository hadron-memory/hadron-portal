/**
 * portal#2245 — the task page's role task names. The result stores URN and revision
 * but no name, so the loader reads each name live; any failure leaves the id out
 * (the row shows the URN leaf) and the page still loads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASK_DETAIL_QUERY, ROLE_TASK_NAME_QUERY } from '$lib/server/queries';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
let task: Record<string, unknown>;
let nodes: Record<string, () => unknown>;
const request = vi.fn(async (q: string, v?: { ref: string }) => {
  if (q === AGENT_TASK_DETAIL_QUERY) return { agentTask: task };
  if (q === ROLE_TASK_NAME_QUERY) return nodes[v!.ref]();
  return {};
});
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
vi.mock('$lib/server/agent-tasks', () => ({
  loadTasksApp: async () => app,
  loadTree: async () => [],
  loadAncestors: async () => ({ ancestors: [], truncated: false }),
  canonicalTaskId: (x: string) => x,
}));

import { load } from './[taskId]/+page.server';

const ref = (id: string) => ({ nodeId: id, urn: `hrn:node:acme.com:team:tasks:${id}`, revision: 1 });
const run = async () =>
  (await load({ params: { appId: 'app-1', taskId: 't1' }, locals: { token: 't', user: { id: 'u' } }, url: new URL('http://x/'), parent: async () => ({}) } as never)) as { roleTaskNames: Record<string, string> };
const nameCalls = () => request.mock.calls.filter(([q]) => q === ROLE_TASK_NAME_QUERY);

beforeEach(() => {
  request.mockClear();
  nodes = {};
  task = { id: 't1', appId: 'app-1', result: { outcome: 'SUCCESS', summary: null, evidence: null, workedFromRoleTaskRefs: [ref('a'), ref('b')] } };
});

describe('role task names', () => {
  it('reads one name per ref, in order', async () => {
    nodes = { a: () => ({ node: { name: 'Alpha' } }), b: () => ({ node: { name: 'Beta' } }) };
    expect((await run()).roleTaskNames).toEqual({ a: 'Alpha', b: 'Beta' });
    expect(nameCalls().map(([, v]) => (v as { ref: string }).ref)).toEqual(['a', 'b']);
  });
  it('leaves an unreadable, deleted or failing node out and still loads', async () => {
    nodes = { a: () => ({ node: null }), b: () => { throw new Error('forbidden'); } };
    expect((await run()).roleTaskNames).toEqual({});
    expect(nameCalls()).toHaveLength(2); // no extra read asks why
  });
  it('leaves out a node that answers with no name', async () => {
    nodes = { a: () => ({ node: { name: null } }), b: () => ({ node: { name: '' } }) };
    expect((await run()).roleTaskNames).toEqual({});
  });
  it('keeps the names it got when another read fails', async () => {
    nodes = { a: () => { throw new Error('boom'); }, b: () => ({ node: { name: 'Beta' } }) };
    expect((await run()).roleTaskNames).toEqual({ b: 'Beta' });
  });
  it('reads one name for a ref the result lists twice', async () => {
    task = { ...task, result: { outcome: 'SUCCESS', summary: null, evidence: null, workedFromRoleTaskRefs: [ref('a'), ref('a')] } };
    nodes = { a: () => ({ node: { name: 'Alpha' } }) };
    await run();
    expect(nameCalls()).toHaveLength(1);
  });
  it.each([['null', null], ['absent', undefined]])('makes no name read for %s refs, or for a task with no result', async (_n, refs) => {
    task = { ...task, result: { outcome: 'SUCCESS', summary: null, evidence: null, workedFromRoleTaskRefs: refs } };
    expect((await run()).roleTaskNames).toEqual({});
    task = { ...task, result: null };
    expect((await run()).roleTaskNames).toEqual({});
    expect(nameCalls()).toHaveLength(0);
  });
});
