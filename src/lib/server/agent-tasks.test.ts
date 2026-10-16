/**
 * portal#1052 — the Tasks views' reads and their three outcomes: rows, a
 * non-participant (APP_NOT_FOUND, and only that code), or a failure that is
 * never an empty list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphQLClient } from 'graphql-request';
import { AGENT_TASK_ANCESTOR_QUERY, AGENT_TASK_EVENTS_QUERY, AGENT_TASKS_BOARD_QUERY } from '$lib/server/queries';
import { BOARD_LIMIT, HISTORY_LIMIT, loadAncestors, loadBoard, loadHistory, loadTree } from './agent-tasks';

const request = vi.fn();
const client = { request } as unknown as GraphQLClient;
const gqlError = (code: string) => ({ response: { errors: [{ message: code, extensions: { code } }] } });

beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('loadBoard', () => {
  it('reads roots only, with the filter’s arguments and the cap', async () => {
    request.mockResolvedValueOnce({ agentTasks: [] });
    await loadBoard(client, 'app-1', 'backlog');
    expect(request).toHaveBeenCalledWith(AGENT_TASKS_BOARD_QUERY, { appRef: 'app-1', status: ['BACKLOG'], limit: BOARD_LIMIT });
    expect(AGENT_TASKS_BOARD_QUERY).toContain('rootsOnly: true');
  });

  it('a full page is reported as capped, a short one is not', async () => {
    request.mockResolvedValueOnce({ agentTasks: Array.from({ length: BOARD_LIMIT }, (_, i) => ({ id: `t${i}` })) });
    expect(await loadBoard(client, 'app-1', 'all')).toMatchObject({ kind: 'ok', value: { capped: true } });
    request.mockResolvedValueOnce({ agentTasks: [{ id: 't1' }] });
    expect(await loadBoard(client, 'app-1', 'all')).toMatchObject({ kind: 'ok', value: { capped: false } });
  });

  it('APP_NOT_FOUND means the viewer doesn’t take part', async () => {
    request.mockRejectedValueOnce(gqlError('APP_NOT_FOUND'));
    expect(await loadBoard(client, 'app-1', 'active')).toEqual({ kind: 'not-participant' });
  });

  it('any other failure is a failure, not an empty board', async () => {
    request.mockRejectedValueOnce(gqlError('FORBIDDEN'));
    expect(await loadBoard(client, 'app-1', 'active')).toEqual({ kind: 'failed' });
    request.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await loadBoard(client, 'app-1', 'active')).toEqual({ kind: 'failed' });
  });
});

describe('loadTree', () => {
  it('null from the server is a missing root, not a failure', async () => {
    request.mockResolvedValueOnce({ agentTaskTree: null });
    expect(await loadTree(client, 't1')).toEqual({ kind: 'ok', value: null });
  });
});

describe('loadHistory', () => {
  const page = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ id: `e${from + i}` }));

  it('walks forward by the last id until a short page', async () => {
    request.mockResolvedValueOnce({ agentTeamEvents: page(200, 0) }).mockResolvedValueOnce({ agentTeamEvents: page(3, 200) });
    const r = await loadHistory(client, 'app-1', 't1');
    expect(r).toMatchObject({ kind: 'ok', value: { capped: false } });
    expect(r.kind === 'ok' && r.value.events).toHaveLength(203);
    expect(request.mock.calls[0]).toEqual([AGENT_TASK_EVENTS_QUERY, { appRef: 'app-1', taskId: 't1', after: undefined, limit: 200 }]);
    expect(request.mock.calls[1][1]).toMatchObject({ after: 'e199' });
  });

  it('stops at the bound and says so', async () => {
    let n = 0;
    request.mockImplementation(async () => ({ agentTeamEvents: page(200, (n++) * 200) }));
    const r = await loadHistory(client, 'app-1', 't1');
    expect(r).toMatchObject({ kind: 'ok', value: { capped: true } });
    expect(r.kind === 'ok' && r.value.events).toHaveLength(HISTORY_LIMIT);
    expect(request).toHaveBeenCalledTimes(HISTORY_LIMIT / 200);
  });
});

describe('loadAncestors', () => {
  it('follows parents, root first', async () => {
    request
      .mockResolvedValueOnce({ agentTask: { id: 'p', title: 'Parent', parentTaskId: 'g' } })
      .mockResolvedValueOnce({ agentTask: { id: 'g', title: 'Grand', parentTaskId: null } });
    expect(await loadAncestors(client, 'p')).toEqual({
      ancestors: [{ id: 'g', title: 'Grand' }, { id: 'p', title: 'Parent' }],
      truncated: false,
    });
    expect(request).toHaveBeenCalledWith(AGENT_TASK_ANCESTOR_QUERY, { id: 'p' });
  });

  it('a root task has none, and asks nothing', async () => {
    expect(await loadAncestors(client, null)).toEqual({ ancestors: [], truncated: false });
    expect(request).not.toHaveBeenCalled();
  });

  it('a failed or unreadable link ends the chain as truncated', async () => {
    request.mockResolvedValueOnce({ agentTask: { id: 'p', title: 'Parent', parentTaskId: 'g' } }).mockRejectedValueOnce(new Error('down'));
    expect(await loadAncestors(client, 'p')).toEqual({ ancestors: [{ id: 'p', title: 'Parent' }], truncated: true });
  });
});
