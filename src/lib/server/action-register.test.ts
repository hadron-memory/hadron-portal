/**
 * portal#1649 — the action-register reads: the exact variables each view
 * sends (agentRef ALWAYS), the three refusals kept apart from empty and from
 * failure, and the option lists' honesty about being partial.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTION_REGISTER_INDEX_QUERY,
  APP_AGENT_OPTIONS_QUERY,
  AGENT_APP_OPTIONS_QUERY,
  loadActionRegisterIndex,
  loadAppAgentOptions,
  loadAgentAppOptions,
} from './action-register';

const request = vi.fn();
const client = { request } as never;
const gqlError = (code: string) => ({ response: { errors: [{ message: 'server words', extensions: { code } }] } });
const page = { entries: [{ code: 'a', state: 'MAPPED', taskLoc: 'x', taskUrn: 'u', definedBy: null, entryUrn: null, actionUrn: null }], total: 1, hasMore: false };

beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('actionRegisterIndex', () => {
  it('always sends appRef and agentRef, with the paging and filters as given', async () => {
    request.mockResolvedValue({ actionRegisterIndex: page });
    const r = await loadActionRegisterIndex(client, { appRef: 'app-1', agentRef: 'agent-1', taskLoc: 'tasks:build', limit: 500, offset: 40 });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toBe(ACTION_REGISTER_INDEX_QUERY);
    expect(request.mock.calls[0][1]).toEqual({ appRef: 'app-1', agentRef: 'agent-1', taskLoc: 'tasks:build', code: null, limit: 500, offset: 40 });
    expect(r).toEqual({ kind: 'ok', page });
  });
  it('refuses to send without an asking Agent', async () => {
    await expect(loadActionRegisterIndex(client, { appRef: 'app-1', agentRef: '', limit: 20, offset: 0 })).rejects.toThrow(/agentRef/);
    expect(request).not.toHaveBeenCalled();
  });
  it('keeps the server page untouched: total and hasMore are the provider values', async () => {
    request.mockResolvedValue({ actionRegisterIndex: { ...page, total: 45, hasMore: true } });
    const r = await loadActionRegisterIndex(client, { appRef: 'a', agentRef: 'g', limit: 20, offset: 0 });
    expect(r).toMatchObject({ kind: 'ok', page: { total: 45, hasMore: true } });
  });
  it.each([
    ['APP_NOT_FOUND', 'app-not-found'],
    ['AGENT_NOT_FOUND', 'agent-not-found'],
  ])('%s is %s', async (code, kind) => {
    request.mockRejectedValue(gqlError(code));
    expect(await loadActionRegisterIndex(client, { appRef: 'a', agentRef: 'g', limit: 20, offset: 0 })).toEqual({ kind });
  });
  it.each(['BAD_USER_INPUT', 'INTERNAL_SERVER_ERROR', 'FORBIDDEN'])('%s is a safe failure, never empty or not-found', async (code) => {
    request.mockRejectedValue(gqlError(code));
    expect(await loadActionRegisterIndex(client, { appRef: 'a', agentRef: 'g', limit: 20, offset: 0 })).toEqual({ kind: 'failed' });
  });
  it('a transport error is a failure', async () => {
    request.mockRejectedValue(new Error('socket hang up'));
    expect(await loadActionRegisterIndex(client, { appRef: 'a', agentRef: 'g', limit: 20, offset: 0 })).toEqual({ kind: 'failed' });
  });
  it('a missing field is a failure, not an empty index', async () => {
    request.mockResolvedValue({ actionRegisterIndex: null });
    expect(await loadActionRegisterIndex(client, { appRef: 'a', agentRef: 'g', limit: 20, offset: 0 })).toEqual({ kind: 'failed' });
  });
});

describe('the App view: asking-Agent options', () => {
  const a1 = { id: 'g1', name: 'Builder', urn: 'hrn:agent:acme.com:builder' };
  const a2 = { id: 'g2', name: 'Reviewer', urn: 'hrn:agent:acme.com:reviewer' };
  it('is the installed Agents plus the cast workers\' Agents, once each, withheld ones left out', async () => {
    request.mockImplementation(async (q: string) => {
      if (q === APP_AGENT_OPTIONS_QUERY) return { app: { appAgents: [{ agent: a1 }, { agent: null }] }, workers: { items: [{ agent: a2 }, { agent: a1 }, { agent: null }], total: 3 } };
      throw new Error('unexpected');
    });
    const r = await loadAppAgentOptions(client, 'app-1');
    expect(r).toEqual({ kind: 'ok', agents: [a1, a2], partial: false });
  });
  it('says so when the worker read was cut short', async () => {
    request.mockResolvedValue({ app: { appAgents: [] }, workers: { items: [{ agent: a1 }], total: 450 } });
    expect(await loadAppAgentOptions(client, 'app-1')).toMatchObject({ kind: 'ok', partial: true });
  });
  it('a failed read is not "no options"', async () => {
    request.mockRejectedValue(new Error('down'));
    expect(await loadAppAgentOptions(client, 'app-1')).toEqual({ kind: 'failed' });
  });
});

describe('the definition view: App options for the route Agent', () => {
  it('lists the Apps the Agent is installed in, by name, once each', async () => {
    const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team' };
    request.mockResolvedValue({ agent: { id: 'g1', apps: [app, app] } });
    const r = await loadAgentAppOptions(client, 'g1');
    expect(request.mock.calls[0][0]).toBe(AGENT_APP_OPTIONS_QUERY);
    expect(r).toEqual({ kind: 'ok', apps: [app] });
  });
  it('an unreadable Agent has no options', async () => {
    request.mockResolvedValue({ agent: null });
    expect(await loadAgentAppOptions(client, 'g1')).toEqual({ kind: 'ok', apps: [] });
  });
  it('a failed read is not "no options"', async () => {
    request.mockRejectedValue(new Error('down'));
    expect(await loadAgentAppOptions(client, 'g1')).toEqual({ kind: 'failed' });
  });
});
