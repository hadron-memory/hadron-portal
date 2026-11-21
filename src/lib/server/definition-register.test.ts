/**
 * portal#1649 — the definition page's section read: the route's Agent is the
 * asking Agent, taskLoc is this definition's loc, and the App is only ever the
 * viewer's choice or the single option, never a guess.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION_REGISTER_INDEX_QUERY, AGENT_APP_OPTIONS_QUERY } from './action-register';
import { loadDefinitionRegister } from './definition-register';

const request = vi.fn();
const client = { request } as never;
const a1 = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team' };
const a2 = { id: 'app-2', name: 'Other', urn: 'hrn:app:acme.com:other' };
const node = { loc: 'tasks:build', urn: 'hrn:node:acme.com:base:tasks:build' };
const gqlError = (code: string) => ({ response: { errors: [{ message: 'x', extensions: { code } }] } });
const page = { entries: [], total: 0, hasMore: false };

function answer(apps: unknown[], index: unknown = { actionRegisterIndex: page }) {
  request.mockImplementation(async (q: string) => {
    if (q === AGENT_APP_OPTIONS_QUERY) return { agent: { id: 'g1', apps } };
    if (q === ACTION_REGISTER_INDEX_QUERY) { if (index instanceof Error || (index as any)?.response) throw index; return index; }
    throw new Error('unexpected');
  });
}
const run = (qs = '') => loadDefinitionRegister(client, { agentId: 'g1', node, params: new URLSearchParams(qs) });
const calls = () => request.mock.calls.filter((c) => c[0] === ACTION_REGISTER_INDEX_QUERY);

beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('definition register section', () => {
  it('with exactly one App, preselects it and asks as the route Agent for this loc', async () => {
    answer([a1]);
    const r = await run();
    expect(calls()[0][1]).toEqual({ appRef: 'app-1', agentRef: 'g1', taskLoc: 'tasks:build', code: null, limit: 20, offset: 0 });
    expect(r).toMatchObject({ kind: 'ready', app: a1, definitionUrn: node.urn });
  });
  it('with several Apps and no choice, asks nothing: the section never guesses', async () => {
    answer([a1, a2]);
    const r = await run();
    expect(calls()).toHaveLength(0);
    expect(r).toMatchObject({ kind: 'ready', app: null, index: null });
  });
  it('uses the chosen App and the URL paging; an App outside the options is not chosen', async () => {
    answer([a1, a2]);
    expect(await run('app=app-2&limit=500&offset=40')).toMatchObject({ app: a2, limit: 500, offset: 40 });
    expect(calls()[0][1]).toMatchObject({ appRef: 'app-2', limit: 500, offset: 40 });
    request.mockClear();
    expect(await run('app=app-9')).toMatchObject({ app: null, index: null });
    expect(calls()).toHaveLength(0);
  });
  it('no App options: not available, which is not an empty list', async () => {
    answer([]);
    expect(await run()).toEqual({ kind: 'unavailable' });
  });
  it('a failed options read is its own state', async () => {
    request.mockRejectedValue(new Error('down'));
    expect(await run()).toEqual({ kind: 'options-failed' });
  });
  it('AGENT_NOT_FOUND stays in the section and never throws: the definition page is unaffected', async () => {
    answer([a1], gqlError('AGENT_NOT_FOUND'));
    expect(await run()).toMatchObject({ kind: 'ready', index: { kind: 'agent-not-found' } });
  });
  it('a transport failure never throws into the page loader', async () => {
    answer([a1], new Error('socket hang up'));
    expect(await run()).toMatchObject({ kind: 'ready', index: { kind: 'failed' } });
  });
});

// portal#1654 items 6 and 7.
describe('#1654 item 7: route-Agent provenance against a hostile ?agent=', () => {
  it('every read asks as the route Agent; a ?agent= in the URL is never an asking Agent', async () => {
    answer([a1]);
    await run('agent=hrn:agent:evil.com:intruder&app=app-1');
    expect(request.mock.calls.length).toBeGreaterThan(0);
    for (const [, vars] of request.mock.calls) {
      expect(JSON.stringify(vars)).not.toContain('intruder');
      expect(JSON.stringify(vars)).not.toContain('evil.com');
    }
    expect(request.mock.calls.some((c) => (c[1] as { agentRef?: string; ref?: string }).agentRef === 'g1' || (c[1] as { ref?: string }).ref === 'g1')).toBe(true);
    expect(calls()[0][1]).toMatchObject({ agentRef: 'g1' });
  });
  it('and the asking Agent shown is the one that was asked', async () => {
    answer([a1]);
    const r = await run('agent=hostile');
    expect(JSON.stringify(r)).not.toContain('hostile');
  });
});

describe('#1654 item 6: the answer says which request it is for', () => {
  it('carries the App as asked, the limit and the offset', async () => {
    answer([a1, a2]);
    expect(await run('app=%20app-2%20&limit=50&offset=40')).toMatchObject({ key: 'app-2|50|40' });
    request.mockClear();
    expect(await run()).toMatchObject({ key: '|20|0' });
  });
});
