import { describe, it, expect, vi } from 'vitest';
import type { GraphQLClient } from 'graphql-request';
import { taskChoices, taskDependencies } from './task-planning';
const app = { id: 'app', urn: 'hrn:app:acme.com:team' };
const task = { id: 't1', appId: 'app', handle: 'AT1.2', title: 'Task', status: 'PENDING' };
function client(answer: unknown) { const request = vi.fn().mockResolvedValue(answer); return { request, api: { request } as unknown as GraphQLClient }; }
describe('task planning authorized reads', () => {
  it('paginates beyond 200 without claiming that a full page is complete', async () => {
    const c = client({ agentTasks: Array.from({ length: 200 }, (_, i) => ({ ...task, id: String(i) })) });
    expect(await taskChoices(c.api, app, 200)).toMatchObject({ kind: 'ok', value: { hasMore: true } });
    expect(c.request.mock.calls[0][1]).toEqual({ appRef: 'app', offset: 200 });
  });
  it('scopes bare handles before the authorized exact read', async () => {
    const c = client({ agentTask: task });
    expect(await taskChoices(c.api, app, 0, 'AT1.2')).toMatchObject({ kind: 'ok', value: { items: [task], hasMore: false } });
    expect(c.request.mock.calls[0][1]).toEqual({ ref: 'hrn:agenttask:acme.com:team:AT1.2' });
  });
  it.each([null, { ...task, appId: 'foreign' }, { ...task, status: 'FINISHED' }, { ...task, handle: 'AT0' }])('conceals unavailable exact results without exposing metadata', async (agentTask) => {
    const c = client({ agentTask });
    expect(await taskChoices(c.api, app, 0, 'id')).toEqual({ kind: 'ok', value: { items: [], hasMore: false } });
  });
  it('discards the entire foreign list response', async () => {
    expect(await taskChoices(client({ agentTasks: [{ ...task, appId: 'foreign' }] }).api, app, 0)).toEqual({ kind: 'failed' });
  });
  it('keeps a failed dependency read unknown rather than empty', async () => {
    const c = client(null); c.request.mockRejectedValue(new Error('internal secret'));
    expect(await taskDependencies(c.api, app.id, 't1')).toEqual({ kind: 'failed' });
  });
  it('retains partial relation state without inventing open counts', async () => {
    const blockedBy = { items: [task], hasMore: true }; const blocks = { items: [], hasMore: false };
    expect(await taskDependencies(client({ agentTask: { id: 't2', appId: 'app', blockedBy, blocks } }).api, app.id, 't2')).toEqual({ kind: 'ok', value: { blockedBy, blocks } });
  });
  it('rejects a same-App response for another task even on the initial page', async () => {
    const page = { items: [], hasMore: false };
    expect(await taskDependencies(client({ agentTask: { id: 'wrong', appId: 'app', blockedBy: page, blocks: page } }).api, app.id, 't2')).toEqual({ kind: 'failed' });
  });
  // portal#1392: each App guard is pinned on its own, so deleting any one of them fails a test
  // (Jack's parent-App mutant on #1388 survived the suite before this).
  it('rejects the right task id returned under another App', async () => {
    const page = { items: [], hasMore: false };
    expect(await taskDependencies(client({ agentTask: { id: 't2', appId: 'foreign', blockedBy: page, blocks: page } }).api, app.id, 't2')).toEqual({ kind: 'failed' });
  });
  it.each(['blockedBy', 'blocks'] as const)('rejects the whole read when one %s row belongs to another App', async (direction) => {
    const empty = { items: [], hasMore: false };
    const pages = { blockedBy: empty, blocks: empty, [direction]: { items: [task, { ...task, id: 'f', appId: 'foreign' }], hasMore: false } };
    expect(await taskDependencies(client({ agentTask: { id: 't2', appId: 'app', ...pages } }).api, app.id, 't2')).toEqual({ kind: 'failed' });
  });

});

// portal#1575 acceptance 4: the reference picker also lists ended tasks (a reference to a finished or
// cancelled task is normal), through a named mode the server maps to its own status list. The default,
// which the new-task parent and TaskPlanning use, is unchanged and pinned above.
describe('taskChoices for a reference (portal#1575)', () => {
  it('lists FINISHED and CANCELLED besides the open statuses, through the reference query', async () => {
    const c = client({ agentTasks: [{ ...task, status: 'FINISHED' }, { ...task, id: 't2', status: 'CANCELLED' }] });
    expect(await taskChoices(c.api, app, 0, undefined, { includeEnded: true })).toMatchObject({ kind: 'ok', value: { items: [{ status: 'FINISHED' }, { status: 'CANCELLED' }] } });
    expect(c.request.mock.calls[0][0]).toMatch(/status: \[BACKLOG, PENDING, STARTED, FINISHED, CANCELLED\]/);
    expect(c.request.mock.calls[0][1]).toEqual({ appRef: 'app', offset: 0 });
  });
  it('the default list query still names the open statuses only', async () => {
    const c = client({ agentTasks: [] });
    await taskChoices(c.api, app, 0);
    expect(c.request.mock.calls[0][0]).toMatch(/status: \[BACKLOG, PENDING, STARTED\]/);
  });
  it.each(['FINISHED', 'CANCELLED'])('an exact lookup finds a %s task', async (status) => {
    const c = client({ agentTask: { ...task, status } });
    expect(await taskChoices(c.api, app, 0, 'AT1.2', { includeEnded: true })).toMatchObject({ kind: 'ok', value: { items: [{ status }] } });
  });
  it('an exact lookup still conceals a foreign task or AT0', async () => {
    for (const agentTask of [{ ...task, appId: 'foreign', status: 'FINISHED' }, { ...task, handle: 'AT0', status: 'BACKLOG' }]) {
      expect(await taskChoices(client({ agentTask }).api, app, 0, 'id', { includeEnded: true })).toEqual({ kind: 'ok', value: { items: [], hasMore: false } });
    }
  });
});
