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
    expect(c.request.mock.calls[0][1]).toEqual({ id: 'hrn:agenttask:acme.com:team:AT1.2' });
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
    expect(await taskDependencies(client({ agentTask: { appId: 'app', blockedBy, blocks } }).api, app.id, 't2')).toEqual({ kind: 'ok', value: { blockedBy, blocks } });
  });
});
