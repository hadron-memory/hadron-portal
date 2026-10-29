/**
 * portal#1052 — the Tasks views' reads and their three outcomes: rows, a
 * non-participant (APP_NOT_FOUND, and only that code), or a failure that is
 * never an empty list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphQLClient } from 'graphql-request';
import { APP_PEOPLE_QUERY, AGENT_ALARMS_QUERY, AGENT_TASK_ANCESTOR_QUERY, AGENT_TASK_EVENTS_QUERY, AGENT_TASKS_BOARD_QUERY, TEAM_ROSTER_QUERY } from '$lib/server/queries';
import { loadWriteCandidates, ALARMS_LIMIT, BOARD_LIMIT, HISTORY_LIMIT, loadAlarms, loadAncestors, loadBoard, loadHistory, loadOpenTaskTitles, loadRoster, loadTree } from './agent-tasks';

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

  // portal#1400: the text operand has to reach the actual document, not just the variables.
  it('declares and uses the text operand in the document', () => {
    expect(AGENT_TASKS_BOARD_QUERY).toContain('$text: String');
    expect(AGENT_TASKS_BOARD_QUERY).toContain('text: $text');
  });

  it('sends the text once, as typed, beside the filter and the cap', async () => {
    request.mockResolvedValueOnce({ agentTasks: [] });
    await loadBoard(client, 'app-1', 'backlog', '50%_\\x');
    expect(request).toHaveBeenCalledWith(AGENT_TASKS_BOARD_QUERY, { appRef: 'app-1', status: ['BACKLOG'], limit: BOARD_LIMIT, text: '50%_\\x' });
  });

  it('sends no text key for none, empty or blank', async () => {
    for (const text of [undefined, null, '', '   ']) {
      request.mockReset();
      request.mockResolvedValueOnce({ agentTasks: [] });
      await loadBoard(client, 'app-1', 'all', text);
      expect(Object.keys(request.mock.calls[0][1])).not.toContain('text');
    }
  });

  it('BAD_USER_INPUT is its own outcome, never an empty board and never a generic failure', async () => {
    request.mockRejectedValueOnce(gqlError('BAD_USER_INPUT'));
    expect(await loadBoard(client, 'app-1', 'all', 'a'.repeat(201))).toEqual({ kind: 'bad-text' });
  });

  it('a BAD_USER_INPUT without text is still a failure (the guidance is about the text)', async () => {
    request.mockRejectedValueOnce(gqlError('BAD_USER_INPUT'));
    expect(await loadBoard(client, 'app-1', 'all')).toEqual({ kind: 'failed' });
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

describe('slice 2: roster, titles and alarms', () => {
  it('the roster read keeps the three outcomes', async () => {
    request.mockResolvedValueOnce({ teamRoster: { asOf: 'x', workers: [] } });
    expect(await loadRoster(client, 'app-1')).toEqual({ kind: 'ok', value: { asOf: 'x', workers: [] } });
    expect(request).toHaveBeenCalledWith(TEAM_ROSTER_QUERY, { appRef: 'app-1' });
    request.mockRejectedValueOnce(gqlError('APP_NOT_FOUND'));
    expect(await loadRoster(client, 'app-1')).toEqual({ kind: 'not-participant' });
    request.mockRejectedValueOnce(new Error('down'));
    expect(await loadRoster(client, 'app-1')).toEqual({ kind: 'failed' });
  });

  it('titles map ids to titles; a failure costs only the titles', async () => {
    request.mockResolvedValueOnce({ agentTasks: [{ id: 't1', title: 'Ship it' }] });
    expect(await loadOpenTaskTitles(client, 'app-1')).toEqual({ t1: 'Ship it' });
    request.mockRejectedValueOnce(new Error('down'));
    expect(await loadOpenTaskTitles(client, 'app-1')).toEqual({});
  });

  it('alarms walk forward by the last id, alarmsOnly, up to the bound', async () => {
    const page = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ id: `a${from + i}` }));
    request.mockResolvedValueOnce({ agentTeamEvents: page(200, 0) }).mockResolvedValueOnce({ agentTeamEvents: page(1, 200) });
    const r = await loadAlarms(client, 'app-1');
    expect(r).toMatchObject({ kind: 'ok', value: { capped: false } });
    expect(request.mock.calls[0]).toEqual([AGENT_ALARMS_QUERY, { appRef: 'app-1', after: undefined, limit: 200 }]);
    expect(request.mock.calls[1][1]).toMatchObject({ after: 'a199' });
    expect(AGENT_ALARMS_QUERY).toContain('alarmsOnly: true');

    request.mockReset();
    let n = 0;
    request.mockImplementation(async () => ({ agentTeamEvents: page(200, (n++) * 200) }));
    const capped = await loadAlarms(client, 'app-1');
    expect(capped).toMatchObject({ kind: 'ok', value: { capped: true } });
    expect(capped.kind === 'ok' && capped.value.alarms).toHaveLength(ALARMS_LIMIT);
  });
});

// portal#1148 (hadron-server#2089): the picker's People are options, not a claim, but a null
// roster (WITHHELD from this viewer) must read as unknown, not as "no members".
describe('loadWriteCandidates: withheld members', () => {
  const route = (people: unknown) => request.mockImplementation(async (doc: string) => {
    if (doc === APP_PEOPLE_QUERY) return people instanceof Error ? Promise.reject(people) : { app: people };
    return { teamRoster: { asOf: 'x', workers: [] } };
  });
  it('members: null is peopleWithheld, not an empty roster', async () => {
    route({ id: 'app-1', members: null });
    expect(await loadWriteCandidates(client, 'app-1')).toMatchObject({ people: [], peopleWithheld: true });
  });
  it('known-empty control: members: [] is not withheld', async () => {
    route({ id: 'app-1', members: [] });
    expect(await loadWriteCandidates(client, 'app-1')).toMatchObject({ people: [], peopleWithheld: false });
  });
  it('members are listed, users without a record dropped', async () => {
    route({ id: 'app-1', members: [{ user: { id: 'u1', handle: 'a', name: 'A' } }, { user: null }] });
    expect(await loadWriteCandidates(client, 'app-1')).toMatchObject({ people: [{ id: 'u1', handle: 'a', name: 'A' }], peopleWithheld: false });
  });
  it('a failed read is its own state: not withheld, and NOT the same payload as a real empty roster', async () => {
    route(new Error('down'));
    const failed = await loadWriteCandidates(client, 'app-1');
    expect(failed).toMatchObject({ people: [], peopleWithheld: false, peopleFailed: true });
    route({ id: 'app-1', members: [] });
    const empty = await loadWriteCandidates(client, 'app-1');
    expect(empty).toMatchObject({ people: [], peopleWithheld: false, peopleFailed: false });
    expect(failed).not.toEqual(empty);
  });
  it('a GraphQL error (not just a transport error) is failed too', async () => {
    route(Object.assign(new Error('x'), { response: { errors: [{ message: 'x', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] } }));
    expect(await loadWriteCandidates(client, 'app-1')).toMatchObject({ peopleFailed: true });
  });
});
