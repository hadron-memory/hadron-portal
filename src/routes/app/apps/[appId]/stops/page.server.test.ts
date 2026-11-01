/**
 * portal#1139 — the stops route's loader and its two actions: concealment,
 * a failed read that stays failed, the exact variables a set and a lift send,
 * every typed refusal, the impersonation guard, and that a refused set is
 * never reported as success.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import {
  APP_VIEWER_MANAGES_QUERY,
  LIFT_TEAM_STOP_SIGNAL_MUTATION,
  SET_TEAM_STOP_SIGNAL_MUTATION,
  STOP_PEOPLE_QUERY,
  STOP_WORKERS_QUERY,
  TEAM_STOP_SIGNALS_QUERY,
} from '$lib/server/stop-signals';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const gqlError = (code: string, message = 'server words') => ({ response: { errors: [{ message, extensions: { code } }] } });
const signal = { id: 's1', level: 'PAUSE', scope: 'WORKER', targetWorkerId: 'w1', live: true };

beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function answer(over: Record<string, unknown> = {}) {
  request.mockImplementation(async (q: string, vars: Record<string, unknown>) => {
    if (q in over) {
      const v = over[q];
      if (v instanceof Error || (v && typeof v === 'object' && 'response' in v)) throw v;
      return v;
    }
    if (q === AGENT_TASKS_APP_QUERY) return { app };
    if (q === APP_VIEWER_MANAGES_QUERY) return { app: { id: 'app-1', viewerManages: true } };
    if (q === TEAM_STOP_SIGNALS_QUERY) return { teamStopSignals: { signals: [signal], pageInfo: { hasNextPage: false, endCursor: null } } };
    if (q === STOP_WORKERS_QUERY) return { teamRoster: { workers: [{ worker: { id: 'w1', name: 'Gaby', urn: 'hrn:worker:acme.com:team:gaby' } }] } };
    if (q === STOP_PEOPLE_QUERY) return { app: { members: [{ user: { id: 'u1', handle: 'holger', name: 'Holger' } }] } };
    throw new Error(`unexpected ${q}`);
  });
}

async function load(search = '', impersonation: unknown = null) {
  const { load } = await import('./+page.server');
  return (await load({
    params: { appId: 'app-1' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation },
    url: new URL(`http://localhost/app/apps/app-1/stops${search}`),
  } as never)) as Record<string, unknown>;
}

async function act(name: 'set' | 'lift', fields: Record<string, string>, impersonation: unknown = null) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const run = actions[name] as (e: never) => Promise<unknown>;
  return (await run({
    request: { formData: async () => fd },
    params: { appId: 'app-1' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation },
  } as never)) as { status?: number; data?: Record<string, unknown> } & Record<string, unknown>;
}

describe('actions', () => {
  it('exports exactly set and lift', async () => {
    const { actions } = await import('./+page.server');
    expect(Object.keys(actions).sort()).toEqual(['lift', 'set']);
  });
});

describe('loader', () => {
  it('reads the table (with ended), the live banner, the hint, the roster and the members', async () => {
    answer();
    const data = await load();
    expect(data.manages).toBe('yes');
    expect(data.page).toMatchObject({ kind: 'ok' });
    expect(data.live).toMatchObject({ kind: 'ok', value: { complete: true } });
    expect(data.workers).toEqual([{ id: 'w1', name: 'Gaby', urn: 'hrn:worker:acme.com:team:gaby' }]);
    expect(data.people).toEqual({ u1: 'Holger' });
    const table = request.mock.calls.find((c) => c[0] === TEAM_STOP_SIGNALS_QUERY && c[1].includeEnded === true);
    expect(table?.[1]).toMatchObject({ appRef: 'app-1', first: 50 });
    expect(request.mock.calls.some((c) => String(c[0]).includes('mutation'))).toBe(false);
  });

  it('B4: a failed roster read is flagged, a loaded one is not, and an empty roster is not a failure', async () => {
    answer({ [STOP_WORKERS_QUERY]: new Error('roster down') });
    const failed = await load();
    expect(failed.workers).toEqual([]);
    expect(failed.rosterFailed).toBe(true);
    answer();
    expect((await load()).rosterFailed).toBe(false);
    answer({ [STOP_WORKERS_QUERY]: { teamRoster: { workers: [] } } });
    const empty = await load();
    expect(empty.workers).toEqual([]);
    expect(empty.rosterFailed).toBe(false);
  });

  it('passes the page cursor through', async () => {
    answer();
    await load('?after=abc');
    const table = request.mock.calls.find((c) => c[0] === TEAM_STOP_SIGNALS_QUERY && c[1].includeEnded === true);
    expect(table?.[1]).toMatchObject({ after: 'abc' });
  });

  it('is a 404 for an App the viewer cannot see', async () => {
    answer({ [AGENT_TASKS_APP_QUERY]: { app: null } });
    await expect(load()).rejects.toMatchObject({ status: 404 });
  });

  it('a failed table read stays failed, and a failed hint is unknown, not no', async () => {
    answer({ [TEAM_STOP_SIGNALS_QUERY]: new Error('boom'), [APP_VIEWER_MANAGES_QUERY]: new Error('boom') });
    const data = await load();
    expect(data.page).toEqual({ kind: 'failed' });
    expect(data.live).toEqual({ kind: 'failed' });
    expect(data.manages).toBe('unknown');
  });

  it('viewerManages false is no', async () => {
    answer({ [APP_VIEWER_MANAGES_QUERY]: { app: { id: 'app-1', viewerManages: false } } });
    expect((await load()).manages).toBe('no');
  });
});

describe('set', () => {
  const fields = { level: 'PAUSE', scope: 'TEAM', worker: 'w1' };

  it('sends the input to the mutation and answers ok with the new id', async () => {
    answer({ [SET_TEAM_STOP_SIGNAL_MUTATION]: { setTeamStopSignal: { ...signal, id: 'new' } } });
    const r = await act('set', fields);
    expect(r).toEqual({ action: 'set', ok: true, signalId: 'new' });
    expect(request).toHaveBeenCalledWith(SET_TEAM_STOP_SIGNAL_MUTATION, { input: { appRef: 'app-1', level: 'PAUSE', scope: 'TEAM', worker: 'w1' } });
  });

  it('refuses a bad form without calling the server', async () => {
    answer();
    const r = await act('set', { level: 'PAUSE', scope: 'WORKER', worker: '' });
    expect(r.status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });

  it('STOP_SIGNAL_UNAVAILABLE is a refusal (nothing set), not success and not uncertain', async () => {
    answer({ [SET_TEAM_STOP_SIGNAL_MUTATION]: gqlError('STOP_SIGNAL_UNAVAILABLE') });
    const r = await act('set', fields);
    expect(r.data).toMatchObject({ action: 'set', refusal: { kind: 'refused', code: 'STOP_SIGNAL_UNAVAILABLE' } });
    expect(r.data).not.toHaveProperty('ok');
  });

  it('APP_MANAGER_REQUIRED is shown for a revoked manager whose stale form is submitted', async () => {
    answer({ [SET_TEAM_STOP_SIGNAL_MUTATION]: gqlError('APP_MANAGER_REQUIRED') });
    const r = await act('set', fields);
    expect(r.data).toMatchObject({ refusal: { kind: 'refused', code: 'APP_MANAGER_REQUIRED' } });
  });

  it('a transport failure is the uncertain line and keeps what was typed', async () => {
    answer({ [SET_TEAM_STOP_SIGNAL_MUTATION]: new Error('socket hang up') });
    const r = await act('set', fields);
    expect(r.data).toMatchObject({ refusal: { kind: 'uncertain' }, values: fields });
  });

  it('an impersonation session never reaches the server', async () => {
    answer();
    const r = await act('set', fields, { id: 'x' });
    expect(r.data).toMatchObject({ refusal: { kind: 'refused', code: 'FORBIDDEN' } });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('lift', () => {
  it('sends the id and reports whether anything changed', async () => {
    answer({ [LIFT_TEAM_STOP_SIGNAL_MUTATION]: { liftTeamStopSignal: { changed: true, signal } } });
    expect(await act('lift', { id: 's1' })).toEqual({ action: 'lift', ok: true, id: 's1', changed: true });
    expect(request).toHaveBeenCalledWith(LIFT_TEAM_STOP_SIGNAL_MUTATION, { appRef: 'app-1', id: 's1' });
  });

  it('changed:false (already ended) is ok, not an error', async () => {
    answer({ [LIFT_TEAM_STOP_SIGNAL_MUTATION]: { liftTeamStopSignal: { changed: false, signal } } });
    expect(await act('lift', { id: 's1' })).toMatchObject({ ok: true, changed: false });
  });

  it('a missing id never reaches the server', async () => {
    answer();
    const r = await act('lift', {});
    expect(r.status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });

  it('STOP_SIGNAL_NOT_FOUND and APP_MANAGER_REQUIRED are typed refusals; an impersonation session is refused locally', async () => {
    answer({ [LIFT_TEAM_STOP_SIGNAL_MUTATION]: gqlError('STOP_SIGNAL_NOT_FOUND') });
    expect((await act('lift', { id: 's1' })).data).toMatchObject({ refusal: { code: 'STOP_SIGNAL_NOT_FOUND' } });
    answer({ [LIFT_TEAM_STOP_SIGNAL_MUTATION]: gqlError('APP_MANAGER_REQUIRED') });
    expect((await act('lift', { id: 's1' })).data).toMatchObject({ refusal: { code: 'APP_MANAGER_REQUIRED' } });
    request.mockClear();
    expect((await act('lift', { id: 's1' }, { id: 'x' })).data).toMatchObject({ refusal: { code: 'FORBIDDEN' } });
    expect(request).not.toHaveBeenCalled();
  });
});
