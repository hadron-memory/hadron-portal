/**
 * portal#1649 — the App action-register route's loader: no query without an
 * asking Agent, agentRef always sent when there is one, the refusals kept
 * apart, and paging read from the URL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import { ACTION_REGISTER_INDEX_QUERY, APP_AGENT_OPTIONS_QUERY } from '$lib/server/action-register';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const agent = { id: 'g1', name: 'Builder', urn: 'hrn:agent:acme.com:builder' };
const gqlError = (code: string) => ({ response: { errors: [{ message: 'server words', extensions: { code } }] } });
const index = { entries: [{ code: 'a', state: 'MAPPED', taskLoc: 'x', taskUrn: 'u' }], total: 1, hasMore: false };

function answer(over: Record<string, unknown> = {}) {
  request.mockImplementation(async (q: string) => {
    if (q in over) {
      const v = over[q];
      if (v && typeof v === 'object' && 'response' in v) throw v;
      return v;
    }
    if (q === AGENT_TASKS_APP_QUERY) return { app };
    if (q === APP_AGENT_OPTIONS_QUERY) return { app: { appAgents: [{ agent }] }, workers: { items: [], total: 0 } };
    if (q === ACTION_REGISTER_INDEX_QUERY) return { actionRegisterIndex: index };
    throw new Error(`unexpected ${q}`);
  });
}
async function load(search = '') {
  const { load } = await import('./+page.server');
  return (await load({ params: { appId: 'app-1' }, locals: { token: 'tok' }, url: new URL(`http://localhost/app/apps/app-1/register${search}`) } as never)) as Record<string, any>;
}
const indexCalls = () => request.mock.calls.filter((c) => c[0] === ACTION_REGISTER_INDEX_QUERY);

beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('register loader', () => {
  it('sends no index query until an Agent is chosen, and says so rather than returning an empty index', async () => {
    answer();
    const d = await load();
    expect(indexCalls()).toHaveLength(0);
    expect(d.index).toBeNull();
    expect(d.chosen).toBeNull();
    expect(d.options).toMatchObject({ kind: 'ok', agents: [agent] });
  });
  it('sends the chosen agentRef with the paging from the URL, and names the Agent', async () => {
    answer();
    const d = await load('?agent=g1&limit=500&offset=40');
    expect(indexCalls()).toHaveLength(1);
    expect(indexCalls()[0][1]).toMatchObject({ appRef: 'app-1', agentRef: 'g1', limit: 200, offset: 40 });
    expect(d.chosen).toEqual(agent);
    expect(d.index).toEqual({ kind: 'ok', page: index });
    expect(d.key).toBe('app-1|g1|200|40');
  });
  it('a non-participant App is the uniform not-found', async () => {
    answer({ [ACTION_REGISTER_INDEX_QUERY]: gqlError('APP_NOT_FOUND') });
    await expect(load('?agent=g1')).rejects.toMatchObject({ status: 404 });
  });
  it('an Agent the server refuses is its own state, not not-found and not empty', async () => {
    answer({ [ACTION_REGISTER_INDEX_QUERY]: gqlError('AGENT_NOT_FOUND') });
    expect((await load('?agent=g9')).index).toEqual({ kind: 'agent-not-found' });
  });
  it('a failed options read is not "no Agents"', async () => {
    answer({ [APP_AGENT_OPTIONS_QUERY]: new Error('down') as never });
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === APP_AGENT_OPTIONS_QUERY) throw new Error('down');
      return { actionRegisterIndex: index };
    });
    expect((await load()).options).toEqual({ kind: 'failed' });
  });
});
