import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphql, buildSchema } from 'graphql';
import { readFileSync } from 'node:fs';
import { AGENT_TASKS_APP_QUERY, AGENT_TASKS_BOARD_QUERY } from '$lib/server/queries';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const fail = (code: string) => ({ response: { errors: [{ message: 'private diagnostic', extensions: { code } }] } });
async function board(text: string, extra = '') {
  const { load } = await import('./+page.server');
  return await load({ params: { appId: app.id }, locals: { token: 'test', impersonation: null },
    url: new URL(`http://localhost/app/apps/app-1/tasks?text=${encodeURIComponent(text)}${extra}`) } as never) as any;
}
beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  request.mockImplementation(async (q: string) => q === AGENT_TASKS_APP_QUERY ? { app } : { agentTasks: [] });
});

describe('board GET search (#1400)', () => {
  it.each(['  Needle  ', '%_\\', 'A & B + #?'])('trims and forwards literal text once: %s', async (text) => {
    const r = await board(text, '&status=ended&view=board');
    expect(r.text).toBe(text.trim());
    expect(request).toHaveBeenLastCalledWith(AGENT_TASKS_BOARD_QUERY, { appRef: app.id, status: ['FINISHED', 'CANCELLED'], text: text.trim(), limit: 200 });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('omits blank text entirely', async () => {
    await expect(board(' \t\n ', '&status=ended')).rejects.toMatchObject({ status: 303, location: '/app/apps/app-1/tasks?status=ended' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(['a'.repeat(200), '😀'.repeat(100), ' '+ 'a'.repeat(200)+' '])('accepts the 200 UTF-16-unit boundary after trimming', async (text) => {
    await board(text);
    expect(request.mock.calls[1][1].text).toBe(text.trim());
  });
  it.each(['a'.repeat(201), '😀'.repeat(100)+'a'])('does not truncate an overlong crafted URL and shows guidance', async (text) => {
    request.mockImplementation(async (q: string) => { if (q === AGENT_TASKS_APP_QUERY) return { app }; throw fail('BAD_USER_INPUT'); });
    const r = await board(text);
    expect(request.mock.calls[1][1].text).toBe(text);
    expect(r.board).toEqual({ kind: 'invalid-search' });
  });
  it.each([['APP_NOT_FOUND', 'not-participant'], ['INTERNAL_SERVER_ERROR', 'failed']])('keeps %s distinct', async (code, kind) => {
    request.mockImplementation(async (q: string) => { if (q === AGENT_TASKS_APP_QUERY) return { app }; throw fail(code); });
    expect((await board('needle')).board).toEqual({ kind });
  });
  // portal#1403 — the no-text BAD_USER_INPUT branch. The guard in loadBoard is
  // `text.trim() && BAD_USER_INPUT`; dropping the text predicate would label a
  // server rejection of an UNSEARCHED read as a search-bounds problem. A read
  // with no text has no bounds to blame: it is a plain failed read.
  it('a BAD_USER_INPUT on a read with no text is a failed read, not search guidance', async () => {
    request.mockImplementation(async (q: string) => { if (q === AGENT_TASKS_APP_QUERY) return { app }; throw fail('BAD_USER_INPUT'); });
    const { load } = await import('./+page.server');
    const r = await load({ params: { appId: app.id }, locals: { token: 'test', impersonation: null },
      url: new URL('http://localhost/app/apps/app-1/tasks?status=ended') } as never) as any;
    expect(r.board).toEqual({ kind: 'failed' });
    expect(request.mock.calls[1][1]).not.toHaveProperty('text');
  });
  it('does not add search to other views', async () => {
    request.mockImplementation(async (q: string, vars: any) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      expect(vars).not.toHaveProperty('text');
      return q.includes('TeamRoster') ? { teamRoster: { workers: [] } } : { agentTasks: [] };
    });
    expect((await board('needle', '&view=roster')).board).toBeNull();
    expect(request.mock.calls.map(c => c[0])).not.toContain(AGENT_TASKS_BOARD_QUERY);
  });
  it('the actual GraphQL operand reaches the resolver before its cap (operand-removal mutant fails)', async () => {
    const schema = buildSchema(readFileSync('schema/schema.graphql', 'utf8'));
    // Legal AgentTask rows; the description-only match is older than 205 roots.
    const roots = Array.from({ length: 206 }, (_, i) => ({
      id: `t${i}`, handle: `AT0.${i + 1}`, priority: 1, blocked: false, title: `Task ${i}`, description: i === 205 ? 'Hidden NeEdLe %_\\' : '',
      status: 'FINISHED', parentTaskId: null, queued: false,
      waitingOnChildren: false, source: null, owner: { id: 'u1', kind: 'USER', name: 'Test', urn: null }, assignee: null, startBy: null,
      createdAt: '2026-10-29T00:00:00Z', updatedAt: null, tags: [],
    }));
    const run = async (document: string, text: string, status = ['FINISHED']) => graphql({ schema, source: document,
      variableValues: { appRef: app.id, text, status, limit: 200 }, rootValue: {
        agentTasks: ({ text, status, limit }: any) => roots.filter(t => (!text || `${t.title} ${t.description}`.toLowerCase().includes(text.toLowerCase())) && (!status || status.includes(t.status))).slice(0, limit),
      } });
    const result = await run(AGENT_TASKS_BOARD_QUERY, 'needle');
    expect(result.errors).toBeUndefined();
    expect(result.data?.agentTasks).toEqual([expect.objectContaining({ id: 't205' })]);
    expect((await run(AGENT_TASKS_BOARD_QUERY, '%_\\')).data?.agentTasks).toHaveLength(1);
    expect((await run(AGENT_TASKS_BOARD_QUERY, 'needle', ['STARTED'])).data?.agentTasks).toEqual([]);
    const mutant = AGENT_TASKS_BOARD_QUERY.replace(/,\s*\$text:\s*String/, '').replace(/,\s*text:\s*\$text/, '');
    const unfiltered = await run(mutant, 'needle');
    expect(unfiltered.errors).toBeUndefined();
    expect(unfiltered.data?.agentTasks).toHaveLength(200);
    expect(unfiltered.data).not.toEqual(result.data);
  });
});
