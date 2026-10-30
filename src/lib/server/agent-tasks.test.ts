/**
 * portal#1052 — the Tasks views' reads and their three outcomes: rows, a
 * non-participant (APP_NOT_FOUND, and only that code), or a failure that is
 * never an empty list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphQLClient } from 'graphql-request';
import { APP_PEOPLE_QUERY, AGENT_ALARMS_QUERY, AGENT_TASK_ANCESTOR_QUERY, AGENT_TASK_EVENTS_QUERY, AGENT_TASK_REF_QUERY, AGENT_TASKS_BOARD_QUERY, TEAM_ROSTER_QUERY } from '$lib/server/queries';
import { loadWriteCandidates, ALARMS_LIMIT, BOARD_LIMIT, HISTORY_LIMIT, loadAlarms, loadAncestors, loadBoard, loadHistory, loadRoster, loadTree, hydrateTaskRefs, canonicalTaskId, HYDRATE_CONCURRENCY } from './agent-tasks';

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

  // portal#1427: each filter sends only its own argument, and none when unset.
  it('sends no overdue or tag argument when nothing is narrowed', async () => {
    request.mockResolvedValueOnce({ agentTasks: [] });
    await loadBoard(client, 'app-1', 'all', '', { overdue: false, tags: [] });
    const vars = request.mock.calls[0][1];
    expect(Object.keys(vars).sort()).toEqual(['appRef', 'limit']);
  });

  it('sends overdue: true and tagsAll, ANDed with the bucket and the text', async () => {
    request.mockResolvedValueOnce({ agentTasks: [] });
    await loadBoard(client, 'app-1', 'queued', ' hello ', { overdue: true, tags: ['ops', 'infra'] });
    expect(request).toHaveBeenCalledWith(AGENT_TASKS_BOARD_QUERY, {
      appRef: 'app-1', queued: true, text: 'hello', overdue: true, tagsAll: ['ops', 'infra'], limit: BOARD_LIMIT,
    });
  });

  it('never sends overdue: false', async () => {
    request.mockResolvedValueOnce({ agentTasks: [] });
    await loadBoard(client, 'app-1', 'active', '', { overdue: false, tags: ['a'] });
    expect(request.mock.calls[0][1]).not.toHaveProperty('overdue');
  });

  it('declares the new arguments in the query', () => {
    expect(AGENT_TASKS_BOARD_QUERY).toContain('$overdue: Boolean');
    expect(AGENT_TASKS_BOARD_QUERY).toContain('$tagsAll: [String!]');
    expect(AGENT_TASKS_BOARD_QUERY).toMatch(/overdue: \$overdue/);
    expect(AGENT_TASKS_BOARD_QUERY).toMatch(/tagsAll: \$tagsAll/);
  });

  it('a failed narrowed read stays a failure, not an empty board', async () => {
    request.mockRejectedValueOnce(gqlError('FORBIDDEN'));
    expect(await loadBoard(client, 'app-1', 'active', '', { overdue: true, tags: [] })).toEqual({ kind: 'failed' });
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

// portal#1349: bare ids hydrated through the readable-task gate.
describe('hydrateTaskRefs', () => {
  const task = (id: string, over: Record<string, unknown> = {}) => ({ agentTask: { id, appId: 'app-1', handle: `AT${id}`, title: `T ${id}`, ...over } });

  it('reads each distinct id once, by id, through agentTask — terminal children included, no open-list scan', async () => {
    request.mockImplementation(async (_q: string, v: { id: string }) => task(v.id));
    const refs = await hydrateTaskRefs(client, 'app-1', ['1', '2', '1', null, undefined, '']);
    expect(refs).toEqual({ 1: { id: '1', handle: 'AT1', title: 'T 1' }, 2: { id: '2', handle: 'AT2', title: 'T 2' } });
    expect(request.mock.calls.map((c) => c[1])).toEqual([{ id: '1' }, { id: '2' }]);
    expect(request.mock.calls.every((c) => c[0] === AGENT_TASK_REF_QUERY)).toBe(true);
  });

  it('a task of another App is unavailable: never used to decorate this App’s row', async () => {
    request.mockResolvedValueOnce(task('1', { appId: 'app-2' }));
    expect(await hydrateTaskRefs(client, 'app-1', ['1'])).toEqual({ 1: null });
  });

  it('missing, unreadable and failed reads are all the same null, and one failure does not cost the rest', async () => {
    request.mockImplementation(async (_q: string, v: { id: string }) => {
      if (v.id === 'missing') return { agentTask: null };
      if (v.id === 'denied') throw gqlError('FORBIDDEN');
      if (v.id === 'down') throw new Error('ECONNRESET');
      return task(v.id);
    });
    expect(await hydrateTaskRefs(client, 'app-1', ['missing', 'denied', 'down', 'ok'])).toEqual({
      missing: null, denied: null, down: null, ok: { id: 'ok', handle: 'ATok', title: 'T ok' },
    });
  });

  it('concurrency is bounded', async () => {
    let live = 0;
    let peak = 0;
    request.mockImplementation(async (_q: string, v: { id: string }) => {
      peak = Math.max(peak, ++live);
      await new Promise((r) => setTimeout(r, 1));
      live--;
      return task(v.id);
    });
    const ids = Array.from({ length: HYDRATE_CONCURRENCY * 3 }, (_, i) => String(i));
    expect(Object.keys(await hydrateTaskRefs(client, 'app-1', ids))).toHaveLength(ids.length);
    expect(peak).toBeLessThanOrEqual(HYDRATE_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });

  it('no ids, no reads', async () => {
    expect(await hydrateTaskRefs(client, 'app-1', [])).toEqual({});
    expect(request).not.toHaveBeenCalled();
  });
});

describe('canonicalTaskId (the identity a write uses)', () => {
  const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
  const answer = (found: unknown) => request.mockImplementation(async (q: string) => (q === AGENT_TASK_REF_QUERY ? { agentTask: found } : { app }));

  it('a handle is qualified with the route App and resolves to the server’s canonical id', async () => {
    answer({ id: 'canon-1', appId: 'app-1' });
    expect(await canonicalTaskId(client, 'app-1', 'AT3.405')).toBe('canon-1');
    expect(request).toHaveBeenLastCalledWith(AGENT_TASK_REF_QUERY, { id: 'hrn:agenttask:acme.com:team:AT3.405' });
  });
  it('a raw id is forwarded unchanged', async () => {
    answer({ id: 'abc', appId: 'app-1' });
    await canonicalTaskId(client, 'app-1', 'abc');
    expect(request).toHaveBeenLastCalledWith(AGENT_TASK_REF_QUERY, { id: 'abc' });
  });
  it('another App’s qualified handle is a 404 with NO task read', async () => {
    answer({ id: 'x', appId: 'app-2' });
    await expect(canonicalTaskId(client, 'app-1', 'hrn:agenttask:acme.com:other:AT3')).rejects.toMatchObject({ status: 404 });
    expect(request.mock.calls.map((c) => c[0])).not.toContain(AGENT_TASK_REF_QUERY);
  });
  it('a task of another App, or none, is the same 404', async () => {
    answer({ id: 'x', appId: 'app-2' });
    await expect(canonicalTaskId(client, 'app-1', 'AT3')).rejects.toMatchObject({ status: 404 });
    answer(null);
    await expect(canonicalTaskId(client, 'app-1', 'AT3')).rejects.toMatchObject({ status: 404 });
  });
  it('a refused App is a 404 before any task read', async () => {
    request.mockRejectedValueOnce(gqlError('FORBIDDEN'));
    await expect(canonicalTaskId(client, 'app-1', 'AT3')).rejects.toMatchObject({ status: 404 });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
