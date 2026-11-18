/**
 * portal#2261 — the sections endpoint: the deferred reads of the task detail page. Authorization is the
 * viewer's own token under the same gates as the page (cor:acl): an unreadable App or task is the neutral 404
 * BEFORE any section read, and a section the endpoint doesn't know is a 400 that reads nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASK_EVENTS_QUERY, AGENT_TASK_REF_QUERY, AGENT_TASKS_APP_QUERY, MEMORIES_QUERY, TEAM_ROSTER_QUERY, APP_PEOPLE_QUERY } from '$lib/server/queries';
import { GET } from './[taskId]/sections/+server';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const get = (section: string | null, locals: Record<string, unknown> = { token: 'tok', impersonation: null }) =>
  Promise.resolve(GET({ params: { appId: 'app-1', taskId: 't1' }, locals, url: new URL(`https://x/sections${section ? `?section=${section}` : ''}`) } as never));

beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  request.mockImplementation(async (q: string) => {
    if (q === AGENT_TASKS_APP_QUERY) return { app };
    if (q === AGENT_TASK_REF_QUERY) return { agentTask: { id: 't1', appId: 'app-1' } };
    if (q === AGENT_TASK_EVENTS_QUERY) return { agentTeamEvents: [] };
    if (q === TEAM_ROSTER_QUERY) return { teamRoster: { workers: [{ worker: { id: 'w1', name: 'Dara', urn: 'hrn:worker:a:b:dara' }, role: 'eng', family: 'claude', freeFamilies: [], launchableFamilies: [], unavailableFamilies: [] }] } };
    if (q === APP_PEOPLE_QUERY) return { app: { members: [] } };
    if (q === MEMORIES_QUERY) return { memories: [] };
    throw new Error('unexpected');
  });
});

describe('sections endpoint (portal#2261)', () => {
  it.each([null, 'nope', 'HISTORY', 'history,review'])('an unknown section (%s) is a 400 and reads nothing', async (section) => {
    await expect(get(section)).rejects.toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
  });

  it('an unreadable App is the neutral 404 before any section read', async () => {
    request.mockImplementation(async (q: string) => { if (q === AGENT_TASKS_APP_QUERY) return { app: null }; throw new Error('read past the gate'); });
    await expect(get('history')).rejects.toMatchObject({ status: 404 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('an unreadable task is the neutral 404 before any section read', async () => {
    request.mockImplementation(async (q: string) => { if (q === AGENT_TASKS_APP_QUERY) return { app }; if (q === AGENT_TASK_REF_QUERY) return { agentTask: null }; throw new Error('read past the gate'); });
    await expect(get('history')).rejects.toMatchObject({ status: 404 });
    expect(request.mock.calls.map((c) => c[0])).not.toContain(AGENT_TASK_EVENTS_QUERY);
  });

  it('answers private and uncached', async () => {
    const r = await get('history');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ kind: 'ok', value: { events: [], capped: false } });
  });

  it('a failing read is the section’s failed VALUE (status 200), never empty and never a throw', async () => {
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === AGENT_TASK_REF_QUERY) return { agentTask: { id: 't1', appId: 'app-1' } };
      throw new Error('down');
    });
    for (const section of ['history', 'review', 'dependencies', 'clones', 'findings', 'memories']) {
      const r = await get(section);
      expect(r.status).toBe(200);
      expect(await r.json(), section).toMatchObject({ kind: expect.stringMatching(/^(failed|not-participant)$/) });
    }
  });

  it('pickers: the roster and the people, with the requirement options', async () => {
    const body = (await (await get('pickers')).json()) as { kind: string; value: { workers: unknown[]; roles: string[]; families: string[] } };
    expect(body.kind).toBe('ok');
    expect(body.value.workers).toHaveLength(1);
    expect(body.value.roles).toEqual(['eng']);
    expect(body.value.families).toEqual(['claude']);
  });

  it('an impersonation session reads no pickers and no memories, and gets them empty', async () => {
    const locals = { token: 'tok', impersonation: { id: 'i1' } };
    const pickers = await (await get('pickers', locals)).json();
    expect(pickers).toMatchObject({ kind: 'ok', value: { workers: [], people: [], roles: [], families: [] } });
    expect(await (await get('memories', locals)).json()).toEqual({ kind: 'ok', value: [] });
    const asked = request.mock.calls.map((c) => c[0]);
    for (const q of [TEAM_ROSTER_QUERY, APP_PEOPLE_QUERY, MEMORIES_QUERY]) expect(asked).not.toContain(q);
  });
});
