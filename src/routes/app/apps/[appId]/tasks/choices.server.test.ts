/** portal#1392 (Rook's optional §10 pin on #1388): the task picker's offset is validated before any task read. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import { GET } from './choices/+server';

const app = { id: 'app', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const request = vi.fn(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { agentTasks: [] }));
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
beforeEach(() => { request.mockClear(); });
const get = (query: string) => GET({ locals: { token: 't' }, params: { appId: 'app' }, url: new URL(`http://localhost/choices?${query}`) } as never);
const taskReads = () => request.mock.calls.filter(([q]) => q !== AGENT_TASKS_APP_QUERY);

describe('task picker offset validation', () => {
  it.each(['-1', '1.5', 'abc', '9007199254740992'])('refuses offset=%s with 400 before reading tasks', async (offset) => {
    await expect(get(`offset=${offset}`)).rejects.toMatchObject({ status: 400 });
    expect(taskReads()).toEqual([]);
  });
  it.each([['offset=0', 0], ['offset=200', 200], ['', 0]] as const)('control: %s reads the page at that offset', async (query, offset) => {
    expect(await (await get(query)).json()).toEqual({ kind: 'ok', value: { items: [], hasMore: false } });
    expect(taskReads()).toEqual([[expect.any(String), { appRef: 'app', offset }]]);
  });
});
