import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphql, buildSchema } from 'graphql';
import { readFileSync } from 'node:fs';
import { AGENT_TASKS_APP_QUERY, AGENT_TASK_REF_QUERY, TASK_BLOCKED_BY_PAGE_QUERY, TASK_BLOCKS_PAGE_QUERY } from '$lib/server/queries';
import { taskDependencyPage } from '$lib/server/task-planning';
import { actions } from './[taskId]/+page.server';
import { GET } from './[taskId]/relations/+server';
const request = vi.fn(); const rawRequest = vi.fn(); const gqlClient = vi.fn(() => ({ request, rawRequest }));
vi.mock('$lib/server/api', () => ({ gqlClient: (...args: unknown[]) => { void args; return gqlClient(); } }));
const app = { id: 'app', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const choice = (i: number) => ({ id: `t${i}`, appId: app.id, handle: `AT1.${i}`, title: `Task ${i}`, status: 'PENDING' });
const schema = buildSchema(readFileSync('schema/schema.graphql', 'utf8'));
beforeEach(() => {
  request.mockReset().mockImplementation(async (doc: string, vars: any) => {
    if (doc === AGENT_TASKS_APP_QUERY) return { app };
    if (doc === AGENT_TASK_REF_QUERY) return { agentTask: { id: 'canonical', appId: app.id } };
    throw new Error(`unexpected query ${vars?.id}`);
  });
  rawRequest.mockReset().mockResolvedValue({ data: { removeAgentTaskBlocker: {} } }); gqlClient.mockClear();
});
function event(direction = 'blockedBy', offset = '200') { return { locals: { token: 'viewer' }, params: { appId: 'app', taskId: 'AT1' }, url: new URL(`http://localhost/relations?direction=${direction}&offset=${offset}`) } as never; }
describe('relation page endpoint and existing remove action', () => {
  it.each(['blockedBy', 'blocks'])('requests only %s at exact offset/limit using the real GraphQL operand, and removes a later blocker', async (direction) => {
    let remaining = Array.from({ length: 205 }, (_, i) => choice(i));
    const offsets: number[] = [];
    request.mockImplementation(async (doc: string, vars: any) => {
      if (doc === AGENT_TASKS_APP_QUERY) return { app };
      if (doc === AGENT_TASK_REF_QUERY) return { agentTask: { id: 'canonical', appId: app.id } };
      const result = await graphql({ schema, source: doc, variableValues: vars, rootValue: { agentTask: () => ({ id: 'canonical', appId: app.id,
        [direction]: ({ limit, offset }: { limit: number; offset: number }) => { expect(limit).toBe(200); offsets.push(offset); return { items: remaining.slice(offset, offset + limit), hasMore: offset + limit < remaining.length, total: remaining.length }; },
        [direction === 'blocks' ? 'blockedBy' : 'blocks']: () => { throw new Error('other direction must not be queried'); },
      }) } });
      expect(result.errors).toBeUndefined(); return result.data;
    });
    const response = await GET(event(direction));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ kind: 'ok', value: { items: remaining.slice(200), hasMore: false } }); expect(offsets).toEqual([200]);
    if (direction === 'blockedBy') {
      const fd = new FormData(); fd.set('blockerTaskRef', 't204');
      expect(await actions.removeBlocker!({ params: { appId: 'app', taskId: 'AT1' }, locals: { token: 'viewer' }, request: { formData: async () => fd } } as never)).toMatchObject({ ok: true });
      expect(rawRequest).toHaveBeenCalledWith(expect.stringContaining('removeAgentTaskBlocker'), { taskRef: 'canonical', blockerTaskRef: 't204' });
      remaining = remaining.filter((t) => t.id !== 't204');
      expect(await (await GET(event(direction, '0'))).json()).toMatchObject({ kind: 'ok', value: { items: remaining.slice(0, 200), hasMore: true } });
    }
  });
  it.each([['blocks','-1'],['blockedBy','1.5'],['bad','0'],['blocks','9007199254740992']])('rejects invalid page %s/%s before reading', async (direction, offset) => {
    await expect(GET(event(direction, offset))).rejects.toMatchObject({ status: 400 }); expect(request).not.toHaveBeenCalled();
  });
  it('keeps a failed query unknown without diagnostic disclosure', async () => {
    request.mockRejectedValue(new Error('private fault'));
    expect(await (await GET(event())).json()).toEqual({ kind: 'failed' });
  });
  it.each(['app', 'task', 'row'])('rejects a foreign or mismatched %s on every page', async (kind) => {
    const c = { request: vi.fn().mockResolvedValue({ agentTask: { id: kind === 'task' ? 'wrong' : 'canonical', appId: kind === 'app' ? 'foreign' : 'app', blockedBy: { items: [{ ...choice(204), appId: kind === 'row' ? 'foreign' : 'app' }], hasMore: false } } }) };
    expect(await taskDependencyPage(c as never, app.id, 'canonical', 'blockedBy', 200)).toEqual({ kind: 'failed' });
  });
  it('selects no totals or blocked counts', () => { expect(TASK_BLOCKED_BY_PAGE_QUERY + TASK_BLOCKS_PAGE_QUERY).not.toMatch(/\btotal\b|\bblocked\b/); });
});
