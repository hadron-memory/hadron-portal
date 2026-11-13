/**
 * portal#1052 — the Tasks views' reads and their three outcomes: rows, a
 * non-participant (APP_NOT_FOUND, and only that code), or a failure that is
 * never an empty list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphQLClient } from 'graphql-request';
import { AGENT_TASK_DETAIL_QUERY, APP_PEOPLE_QUERY, AGENT_ALARMS_QUERY, AGENT_ALARMS_IN_EFFECT_QUERY, AGENT_TASK_ANCESTOR_QUERY, AGENT_TASK_EVENTS_QUERY, AGENT_TASK_REF_QUERY, AGENT_TASKS_BOARD_QUERY, PULL_REQUEST_READINESS_QUERY, TASK_REVIEW_EVENTS_QUERY, TEAM_ROSTER_QUERY } from '$lib/server/queries';
import { loadWriteCandidates, ALARMS_PAGE_SIZE, BOARD_LIMIT, HISTORY_LIMIT, loadAlarms, loadAncestors, loadBoard, loadHistory, loadReview, loadRoster, loadTree, hydrateTaskRefs, canonicalTaskId, HYDRATE_CONCURRENCY } from './agent-tasks';
import { selectsFieldPath } from '$lib/test/graphql-selection';

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
    // portal#1643: roots only stays the default (a variable defaulting to true), so no filter sends it.
    expect(AGENT_TASKS_BOARD_QUERY).toContain('$rootsOnly: Boolean = true');
    expect(AGENT_TASKS_BOARD_QUERY).toContain('rootsOnly: $rootsOnly');
  });

  // portal#1427: each filter sends only its own argument, and none when unset.
  it('sends no overdue or tag argument when nothing is narrowed', async () => {
    request.mockResolvedValueOnce({ agentTasks: [] });
    await loadBoard(client, 'app-1', 'all', '', { overdue: false, tags: [], unresolved: false });
    const vars = request.mock.calls[0][1];
    expect(Object.keys(vars).sort()).toEqual(['appRef', 'limit']);
  });

  it('sends overdue: true and tagsAll, ANDed with the bucket and the text', async () => {
    request.mockResolvedValueOnce({ agentTasks: [] });
    await loadBoard(client, 'app-1', 'queued', ' hello ', { overdue: true, tags: ['ops', 'infra'], unresolved: false });
    expect(request).toHaveBeenCalledWith(AGENT_TASKS_BOARD_QUERY, {
      appRef: 'app-1', queued: true, text: 'hello', overdue: true, tagsAll: ['ops', 'infra'], limit: BOARD_LIMIT,
    });
  });

  it('never sends overdue: false', async () => {
    request.mockResolvedValueOnce({ agentTasks: [] });
    await loadBoard(client, 'app-1', 'active', '', { overdue: false, tags: ['a'], unresolved: false });
    expect(request.mock.calls[0][1]).not.toHaveProperty('overdue');
  });

  it('unresolved findings asks the server for unresolvedFindings across the tree, ANDed with the bucket', async () => {
    request.mockResolvedValueOnce({ agentTasks: [] });
    await loadBoard(client, 'app-1', 'ended', '', { overdue: false, tags: [], unresolved: true });
    expect(request).toHaveBeenCalledWith(AGENT_TASKS_BOARD_QUERY, { appRef: 'app-1', status: ['FINISHED', 'CANCELLED'], unresolvedFindings: true, rootsOnly: false, limit: BOARD_LIMIT });
    expect(AGENT_TASKS_BOARD_QUERY).toContain('$unresolvedFindings: Boolean');
    expect(AGENT_TASKS_BOARD_QUERY).toMatch(/unresolvedFindings: \$unresolvedFindings/);
  });

  it('declares the new arguments in the query', () => {
    expect(AGENT_TASKS_BOARD_QUERY).toContain('$overdue: Boolean');
    expect(AGENT_TASKS_BOARD_QUERY).toContain('$tagsAll: [String!]');
    expect(AGENT_TASKS_BOARD_QUERY).toMatch(/overdue: \$overdue/);
    expect(AGENT_TASKS_BOARD_QUERY).toMatch(/tagsAll: \$tagsAll/);
  });

  it('a failed narrowed read stays a failure, not an empty board', async () => {
    request.mockRejectedValueOnce(gqlError('FORBIDDEN'));
    expect(await loadBoard(client, 'app-1', 'active', '', { overdue: true, tags: [], unresolved: false })).toEqual({ kind: 'failed' });
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
    request.mockImplementation(async () => {
      if (n === 6) throw new Error('a seventh read'); // An unbounded walk fails this pin instead of hanging the run.
      return { agentTeamEvents: page(200, (n++) * 200) };
    });
    const r = await loadHistory(client, 'app-1', 't1');
    expect(r).toMatchObject({ kind: 'ok', value: { capped: true } });
    expect(r.kind === 'ok' && r.value.events).toHaveLength(HISTORY_LIMIT);
    expect(request).toHaveBeenCalledTimes(6);
  });

  // portal#1713: `agentTeamEvents` has no count or hasMore, so only a sixth page can tell 1000 from more.
  // A fixed fixture stream: this proves the walk's arithmetic, not a snapshot of a stream being written to.
  describe('the bound (portal#1713)', () => {
    const serve = (total: number) =>
      request.mockImplementation(async (_q: string, v: { after?: string }) => {
        const from = v.after ? Number(v.after.slice(1)) + 1 : 0;
        return { agentTeamEvents: page(Math.min(200, Math.max(0, total - from)), from) };
      });

    it.each([
      [999, 999, false, 5],
      [1000, 1000, false, 6],
      [1001, 1000, true, 6],
    ])('a stream of %i shows %i, capped %s, in %i reads', async (total, shown, capped, reads) => {
      serve(total);
      const r = await loadHistory(client, 'app-1', 't1');
      expect(r).toMatchObject({ kind: 'ok', value: { capped } });
      expect(r.kind === 'ok' && r.value.events).toHaveLength(shown);
      expect(request).toHaveBeenCalledTimes(reads);
    });

    const sixthThrows = (e: unknown) => {
      let n = 0;
      request.mockImplementation(async () => {
        if (n === 5) { n++; throw e; }
        return { agentTeamEvents: page(200, (n++) * 200) };
      });
    };

    it('APP_NOT_FOUND on the sixth read is the not-participant state', async () => {
      sixthThrows(gqlError('APP_NOT_FOUND'));
      expect(await loadHistory(client, 'app-1', 't1')).toEqual({ kind: 'not-participant' });
      expect(request).toHaveBeenCalledTimes(6);
    });

    it('any other error on the sixth read fails, the 1000 rows dropped: it can’t tell complete from capped', async () => {
      sixthThrows(new Error('boom'));
      expect(await loadHistory(client, 'app-1', 't1')).toEqual({ kind: 'failed' });
      expect(request).toHaveBeenCalledTimes(6);
    });
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


  it('alarms read one newest-first page, with a look-ahead and an older cursor', async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `a${i}` }));
    request.mockResolvedValueOnce({ agentTeamEvents: page(21) });
    const r = await loadAlarms(client, 'app-1', 'prior');
    expect(r).toMatchObject({ kind: 'ok', value: { nextBefore: 'a19' } });
    expect(r.kind === 'ok' && r.value.alarms).toHaveLength(ALARMS_PAGE_SIZE);
    expect(request.mock.calls[0]).toEqual([AGENT_ALARMS_QUERY, { appRef: 'app-1', before: 'prior', after: undefined, newestFirst: true, limit: 21 }]);
    expect(AGENT_ALARMS_QUERY).toContain('alarmsOnly: true');
    expect(AGENT_ALARMS_QUERY).toContain('newestFirst: $newestFirst');
    request.mockResolvedValueOnce({ agentTeamEvents: page(20) });
    expect(await loadAlarms(client, 'app-1')).toMatchObject({ kind: 'ok', value: { nextBefore: null } });
  });

  // portal#2000 A: the In effect read asks the server to filter (#3934's
  // alarmsInEffect: unacknowledged and no recorded escalation end, App-wide
  // before the page is cut), through its OWN document. The pre-existing
  // document must not name the argument at all: GraphQL validates the
  // document, not the values, so a shared document would break every alarms
  // read against a server older than the argument — the page-local filters
  // keep their exact pre-#2000 wire shape instead.
  it('the in-effect alarms read is its own document; the pre-existing read names no new argument', async () => {
    request.mockResolvedValueOnce({ agentTeamEvents: [{ id: 'a0' }] });
    await loadAlarms(client, 'app-1', undefined, undefined, true);
    expect(request.mock.calls[0]).toEqual([AGENT_ALARMS_IN_EFFECT_QUERY, { appRef: 'app-1', before: undefined, after: undefined, newestFirst: true, limit: 21 }]);
    expect(AGENT_ALARMS_IN_EFFECT_QUERY).toContain('alarmsInEffect: true');
    request.mockResolvedValueOnce({ agentTeamEvents: [{ id: 'a0' }] });
    await loadAlarms(client, 'app-1');
    expect(request.mock.calls[1]).toEqual([AGENT_ALARMS_QUERY, { appRef: 'app-1', before: undefined, after: undefined, newestFirst: true, limit: 21 }]);
    expect(AGENT_ALARMS_QUERY).not.toContain('alarmsInEffect');
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

describe('the task detail read (portal#1523)', () => {
  it('selects the requirements’ minimum model tier', () => {
    expect(selectsFieldPath(AGENT_TASK_DETAIL_QUERY, 'AgentTaskDetail', ['agentTask', 'requirements', 'minTier'])).toBe(true);
  });
});

describe('loadReview (portal#1697)', () => {
  const H = 'a'.repeat(40);
  const readiness = { ready: true, head: H, slots: [] };
  const frozen = { id: 'e1', type: 'pr.frozen', payload: { head: H, pullRequest: 'x' } };
  const answer = (events: unknown[], read: () => unknown = () => ({ pullRequestReadiness: readiness })) =>
    request.mockImplementation(async (q: string) => (q === TASK_REVIEW_EVENTS_QUERY ? { agentTeamEvents: events } : read()));
  const readinessCalls = () => request.mock.calls.filter((c) => c[0] === PULL_REQUEST_READINESS_QUERY);

  it('asks about the frozen head from the task’s own events, once', async () => {
    answer([frozen]);
    expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'ok', value: { readiness, seat: null } });
    expect(request).toHaveBeenCalledWith(TASK_REVIEW_EVENTS_QUERY, expect.objectContaining({ appRef: 'app-1', taskId: 't1', types: ['pr.frozen', 'review.seat.assigned'] }));
    expect(readinessCalls()).toEqual([[PULL_REQUEST_READINESS_QUERY, { taskRef: 't1', head: H }]]);
  });

  it('a task with no frozen head asks nothing about readiness and is no error', async () => {
    answer([]);
    expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'ok', value: { readiness: null, seat: null } });
    expect(readinessCalls()).toEqual([]);
  });

  it('keeps a seat task’s slot and head, and asks nothing about readiness', async () => {
    answer([{ id: 'e1', type: 'review.seat.assigned', payload: { slot: 'local', head: H, supersedes: null } }]);
    expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'ok', value: { readiness: null, seat: { slot: 'local', head: H } } });
    expect(readinessCalls()).toEqual([]);
  });

  it('a frozen head with no schedule is no Review section and no error', async () => {
    answer([frozen], () => { throw gqlError('REVIEW_SCHEDULE_MISSING'); });
    vi.mocked(console.warn).mockClear();
    expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'ok', value: { readiness: null, seat: null } });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('reads every page, so the newest freeze wins on a long stream', async () => {
    const page = Array.from({ length: 200 }, (_, i) => ({ id: `e${i}`, type: 'pr.frozen', payload: { head: 'b'.repeat(40) } }));
    request.mockImplementation(async (q: string, v: { after?: string }) => {
      if (q !== TASK_REVIEW_EVENTS_QUERY) return { pullRequestReadiness: readiness };
      return { agentTeamEvents: v.after ? [frozen] : page };
    });
    await loadReview(client, 'app-1', 't1');
    expect(request).toHaveBeenCalledWith(TASK_REVIEW_EVENTS_QUERY, expect.objectContaining({ after: 'e199' }));
    expect(readinessCalls()[0][1]).toEqual({ taskRef: 't1', head: H });
  });

  // portal#1713: a fixed fixture stream, oldest first, whose LAST event carries the newest head.
  describe('the bound (portal#1713)', () => {
    const OLD = 'b'.repeat(40);
    const reads = () => request.mock.calls.filter((c) => c[0] === TASK_REVIEW_EVENTS_QUERY);
    const event = (i: number, total: number) => ({ id: `e${i}`, type: 'pr.frozen', payload: { head: i === total - 1 ? H : OLD } });
    const serve = (total: number) =>
      request.mockImplementation(async (q: string, v: { after?: string }) => {
        if (q !== TASK_REVIEW_EVENTS_QUERY) return { pullRequestReadiness: readiness };
        if (reads().length > 6) throw new Error('a seventh read'); // An unbounded walk fails these pins instead of hanging the run.
        const from = v.after ? Number(v.after.slice(1)) + 1 : 0;
        return { agentTeamEvents: Array.from({ length: Math.min(200, Math.max(0, total - from)) }, (_, i) => event(from + i, total)) };
      });
    const sixthThrows = (e: unknown) => {
      let n = 0;
      request.mockImplementation(async () => {
        if (n === 5) { n++; throw e; }
        const from = (n++) * 200;
        return { agentTeamEvents: Array.from({ length: 200 }, (_, i) => event(from + i, Infinity)) };
      });
    };

    it.each([[999, 5], [1000, 6]])('a stream of %i is complete: the newest head, in %i reads', async (total, count) => {
      serve(total);
      expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'ok', value: { readiness, seat: null } });
      expect(reads()).toHaveLength(count);
      expect(readinessCalls()).toEqual([[PULL_REQUEST_READINESS_QUERY, { taskRef: 't1', head: H }]]);
    });

    it('1001 events are unreadable, never an old head called current, with no seventh read', async () => {
      serve(1001);
      expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'unreadable' });
      expect(reads()).toHaveLength(6);
      expect(readinessCalls()).toEqual([]);
    });

    it('an endless stream is unreadable at six reads', async () => {
      serve(Infinity);
      expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'unreadable' });
      expect(reads()).toHaveLength(6);
      expect(readinessCalls()).toEqual([]);
    });

    it('APP_NOT_FOUND on the sixth read is the not-participant state', async () => {
      sixthThrows(gqlError('APP_NOT_FOUND'));
      expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'not-participant' });
      expect(request).toHaveBeenCalledTimes(6);
    });

    it('any other error on the sixth read stays a failure, which a reload can pass', async () => {
      sixthThrows(new Error('boom'));
      expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'failed' });
      expect(request).toHaveBeenCalledTimes(6);
    });
  });

  // portal#1713: synthetic stored rows; the freeze writer refuses these today.
  describe('a malformed newest event (portal#1713)', () => {
    const OLD = 'b'.repeat(40);
    const SECRET = 'payload-text-that-must-not-be-logged';
    const seat = { id: 'e2', type: 'review.seat.assigned', payload: { slot: 'local', head: OLD } };

    it('a malformed freeze after a valid one is unreadable, and readiness is never asked', async () => {
      answer([frozen, { id: 'e2', type: 'pr.frozen', payload: { head: SECRET } }]);
      expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'unreadable' });
      expect(readinessCalls()).toEqual([]);
    });

    it('a malformed seat after a valid one is unreadable, a valid head with no slot included', async () => {
      answer([seat, { id: 'e3', type: 'review.seat.assigned', payload: { head: H } }]);
      expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'unreadable' });
      expect(readinessCalls()).toEqual([]);
    });

    it('a valid newest freeze with a malformed newest seat is unreadable', async () => {
      answer([frozen, { id: 'e2', type: 'review.seat.assigned', payload: { slot: 'local' } }]);
      expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'unreadable' });
      expect(readinessCalls()).toEqual([]);
    });

    it('a valid event after a malformed one is used', async () => {
      answer([{ id: 'e0', type: 'pr.frozen', payload: { head: 'nope' } }, frozen]);
      expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'ok', value: { readiness, seat: null } });
      expect(readinessCalls()).toEqual([[PULL_REQUEST_READINESS_QUERY, { taskRef: 't1', head: H }]]);
    });

    it('logs the task id and the reason, never the payload', async () => {
      answer([{ id: 'e2', type: 'pr.frozen', payload: { head: SECRET } }]);
      vi.mocked(console.warn).mockClear();
      await loadReview(client, 'app-1', 't1');
      const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
      expect(logged).toContain('t1');
      expect(logged).toContain('pr.frozen');
      expect(logged).not.toContain(SECRET);
    });
  });

  it('a null answer is the not-participant state', async () => {
    answer([frozen], () => ({ pullRequestReadiness: null }));
    expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'not-participant' });
  });

  it('APP_NOT_FOUND on either read is the not-participant state', async () => {
    answer([frozen], () => { throw gqlError('APP_NOT_FOUND'); });
    expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'not-participant' });
    request.mockReset();
    request.mockRejectedValue(gqlError('APP_NOT_FOUND'));
    expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'not-participant' });
  });

  it('anything else fails, including a head that moved between the two reads', async () => {
    answer([frozen], () => { throw gqlError('PR_HEAD_NOT_FROZEN'); });
    expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'failed' });
    request.mockReset();
    request.mockRejectedValue(new Error('boom'));
    expect(await loadReview(client, 'app-1', 't1')).toEqual({ kind: 'failed' });
  });
});
