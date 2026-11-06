import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSchema, graphql } from 'graphql';
import { readFileSync } from 'node:fs';
import { AGENT_TASKS_APP_QUERY, AGENT_TASK_DETAIL_QUERY, AGENT_TASK_FINDINGS_QUERY, AGENT_TASK_REF_QUERY } from '$lib/server/queries';
import { taskFindingsPage } from '$lib/server/task-findings';
import { GET } from './[taskId]/findings/+server';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
const app = { id: 'app', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const schema = buildSchema(readFileSync('schema/schema.graphql', 'utf8'));
const finding = (i: number, text = `text ${i}`) => ({ id: `F${i}`, severity: i % 2 ? 'P2' : 'note', text });
const stored = Array.from({ length: 57 }, (_, i) => finding(i + 1));
const seen: string[] = [];

/** A provider that executes the REAL document against the pinned SDL, so a selection the schema rejects fails here. */
function provider(opts: { result?: 'finished' | 'null'; rows?: ReturnType<typeof finding>[]; taskId?: string; appId?: string } = {}) {
  const rows = opts.rows ?? stored;
  return async (doc: string, vars: Record<string, unknown>) => {
    seen.push(doc);
    if (doc === AGENT_TASKS_APP_QUERY) return { app };
    if (doc === AGENT_TASK_REF_QUERY) return { agentTask: { id: 'canonical', appId: app.id } };
    if (doc !== AGENT_TASK_FINDINGS_QUERY) throw new Error('only the findings read is allowed');
    const out = await graphql({ schema, source: doc, variableValues: vars, rootValue: { agentTask: () => ({
      id: opts.taskId ?? 'canonical', appId: opts.appId ?? app.id,
      result: opts.result === 'null' ? null : { findings: ({ limit, offset }: { limit: number; offset: number }) => {
        const items = rows.slice(offset, offset + limit);
        return { items, total: rows.length, hasMore: offset + items.length < rows.length };
      } },
    }) } });
    expect(out.errors).toBeUndefined();
    return out.data;
  };
}
const event = (offset?: string) => ({ locals: { token: 'viewer' }, params: { appId: 'app', taskId: 'AT1' }, url: new URL(`http://localhost/findings${offset === undefined ? '' : `?offset=${offset}`}`) }) as never;
beforeEach(() => { seen.length = 0; request.mockReset().mockImplementation(provider()); });
afterEach(() => { vi.useRealTimers(); });

describe('AGENT_TASK_FINDINGS_QUERY', () => {
  it('is one narrow read: canonical id, limit/offset, items id/severity/text, total, hasMore — nothing else', () => {
    expect(AGENT_TASK_FINDINGS_QUERY).toMatch(/findings\(limit: \$limit, offset: \$offset\)/);
    for (const field of ['id', 'severity', 'text', 'total', 'hasMore']) expect(AGENT_TASK_FINDINGS_QUERY).toMatch(new RegExp(`\\b${field}\\b`));
    expect(AGENT_TASK_FINDINGS_QUERY).not.toMatch(/dispositions?|events?|mutation/i);
  });
  it('is not part of the shared task detail read', () => { expect(AGENT_TASK_DETAIL_QUERY).not.toMatch(/findings/); });
});

describe('taskFindingsPage', () => {
  it('sends canonical id, limit 20 and the offset; a page is typed', async () => {
    const c = { request: vi.fn(provider()) };
    const out = await taskFindingsPage(c as never, 'app', 'canonical', 20);
    expect(c.request).toHaveBeenCalledTimes(1);
    expect(c.request.mock.calls[0]).toEqual([AGENT_TASK_FINDINGS_QUERY, { id: 'canonical', limit: 20, offset: 20 }]);
    expect(out).toEqual({ kind: 'page', page: { taskId: 'canonical', offset: 20, items: stored.slice(20, 40), total: 57, hasMore: true } });
  });
  it('legacy finished result: a valid zero page is a page, never no-result and never failed', async () => {
    const c = { request: provider({ rows: [] }) };
    expect(await taskFindingsPage({ request: c.request } as never, 'app', 'canonical', 0)).toEqual({ kind: 'page', page: { taskId: 'canonical', offset: 0, items: [], total: 0, hasMore: false } });
  });
  it('null result is no-result (distinct from zero findings)', async () => {
    expect(await taskFindingsPage({ request: provider({ result: 'null' }) } as never, 'app', 'canonical', 0)).toEqual({ kind: 'no-result' });
  });
  it('offset beyond total is a valid empty page', async () => {
    expect(await taskFindingsPage({ request: provider() } as never, 'app', 'canonical', 100)).toEqual({ kind: 'page', page: { taskId: 'canonical', offset: 100, items: [], total: 57, hasMore: false } });
  });
  it('a missing/unreadable task (null) is neutral unavailable', async () => {
    expect(await taskFindingsPage({ request: async () => ({ agentTask: null }) } as never, 'app', 'canonical', 0)).toEqual({ kind: 'unavailable' });
  });
  it.each([
    ['an old provider without the field (GraphQL error)', () => { throw new Error('Cannot query field "findings"'); }],
    ['a transport/db fault', () => { throw new Error('boom'); }],
    ['a malformed response', () => ({ agentTask: { id: 'canonical', appId: 'app', result: { findings: { items: null, total: 1, hasMore: false } } } })],
    ['no findings field at all', () => ({ agentTask: { id: 'canonical', appId: 'app', result: {} } })],
    ['a foreign App row', () => ({ agentTask: { id: 'canonical', appId: 'foreign', result: { findings: { items: [], total: 0, hasMore: false } } } })],
    ['a different task id', () => ({ agentTask: { id: 'other', appId: 'app', result: { findings: { items: [], total: 0, hasMore: false } } } })],
    ['an empty page that claims more', () => ({ agentTask: { id: 'canonical', appId: 'app', result: { findings: { items: [], total: 40, hasMore: true } } } })],
  ])('%s is failed, never empty and never leaks the message', async (_n, answer) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await taskFindingsPage({ request: async () => answer() } as never, 'app', 'canonical', 0);
    expect(out).toEqual({ kind: 'failed' });
  });
  it('the real document is legal under the pinned SDL, and an invented selection is not (the check can fail)', async () => {
    const vars = { id: 'x', limit: 20, offset: 0 };
    const rootValue = { agentTask: () => ({ id: 'x', appId: 'app', result: { findings: () => ({ items: [], total: 0, hasMore: false }) } }) };
    expect((await graphql({ schema, source: AGENT_TASK_FINDINGS_QUERY, variableValues: vars, rootValue })).errors).toBeUndefined();
    const mutant = AGENT_TASK_FINDINGS_QUERY.replace(/\bseverity\b/, 'severityLevel');
    expect((await graphql({ schema, source: mutant, variableValues: vars, rootValue })).errors?.length).toBeGreaterThan(0);
  });
});

describe('GET /tasks/[taskId]/findings', () => {
  it('serves one page at the offset, no-store, under the viewer token, reads only', async () => {
    const response = await GET(event('20'));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ kind: 'page', page: { taskId: 'canonical', offset: 20, items: stored.slice(20, 40), total: 57, hasMore: true } });
    expect(seen.filter((d) => d === AGENT_TASK_FINDINGS_QUERY)).toHaveLength(1);
    expect(seen.every((d) => [AGENT_TASKS_APP_QUERY, AGENT_TASK_REF_QUERY, AGENT_TASK_FINDINGS_QUERY].includes(d))).toBe(true);
  });
  it('defaults the offset to 0', async () => { expect((await (await GET(event())).json()).page.offset).toBe(0); });
  it.each(['-1', '1.5', 'x', '2147483648', '9007199254740992', ''])('rejects offset %j with 400 before any provider call', async (offset) => {
    await expect(GET(event(offset))).rejects.toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
  });
  it('an unreadable App or task keeps the neutral 404 and reads no findings', async () => {
    request.mockImplementation(async (doc: string) => { if (doc === AGENT_TASKS_APP_QUERY) return { app: null }; throw new Error('nope'); });
    await expect(GET(event('0'))).rejects.toMatchObject({ status: 404 });
    request.mockImplementation(async (doc: string) => { if (doc === AGENT_TASKS_APP_QUERY) return { app }; if (doc === AGENT_TASK_REF_QUERY) return { agentTask: null }; throw new Error('nope'); });
    await expect(GET(event('0'))).rejects.toMatchObject({ status: 404 });
  });
  it('a later result:null is the explicit no-result state', async () => {
    request.mockImplementation(provider({ result: 'null' }));
    expect(await (await GET(event('0'))).json()).toEqual({ kind: 'no-result' });
  });
  it('a task that has become unreadable answers 404 unavailable, never rows', async () => {
    request.mockImplementation(async (doc: string) => doc === AGENT_TASK_FINDINGS_QUERY ? { agentTask: null } : provider()(doc, {}));
    const response = await GET(event('0'));
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ kind: 'unavailable' });
  });
  it('a provider fault is a typed failed value with no raw message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    request.mockImplementation(async (doc: string) => { if (doc === AGENT_TASK_FINDINGS_QUERY) throw new Error('secret finding text'); return provider()(doc, {}); });
    const response = await GET(event('0'));
    const body = await response.text(); expect(JSON.parse(body)).toEqual({ kind: 'failed' }); expect(body).not.toContain('secret');
  });
  it('a read that hangs past the optional-list bound is failed, not empty', async () => {
    vi.useFakeTimers();
    request.mockImplementation(async (doc: string) => doc === AGENT_TASK_FINDINGS_QUERY ? new Promise(() => {}) : provider()(doc, {}));
    const pending = GET(event('0')); await vi.advanceTimersByTimeAsync(8001);
    expect(await (await pending).json()).toEqual({ kind: 'failed' });
  });
});
