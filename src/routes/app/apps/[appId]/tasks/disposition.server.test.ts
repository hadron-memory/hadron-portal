/**
 * portal#1643 (hadron-server#2663, hrn:node:hadronmemory.com:specs:cor:agt:050:30) —
 * the disposeFinding write and the paged disposition read.
 *
 * Authority stays the server's: the form action never decides who may dispose, and a
 * refusal changes nothing the reader sees.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSchema, graphql, parse, validate } from 'graphql';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AGENT_TASKS_APP_QUERY, AGENT_TASKS_BOARD_QUERY, AGENT_TASK_FINDING_DISPOSITIONS_QUERY, AGENT_TASK_REF_QUERY, DISPOSE_AGENT_TASK_FINDING_MUTATION } from '$lib/server/queries';
import { taskDispositions } from '$lib/server/task-dispositions';
import { GET } from './[taskId]/dispositions/+server';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: (q: string, v?: unknown) => gated(q, v), rawRequest: async (q: string, v?: unknown) => ({ data: await gated(q, v), extensions: undefined, status: 200 }) }) }));
const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const gated = async (q: string, v?: unknown) => {
  if (q === AGENT_TASKS_APP_QUERY) return { app };
  if (q === AGENT_TASK_REF_QUERY) return { agentTask: { id: (v as { id: string }).id, appId: app.id } };
  return request(q, v);
};
const gqlError = (code: string, message: string) => ({ response: { errors: [{ message, extensions: { code } }] } });
const schema = buildSchema(readFileSync(fileURLToPath(new URL('../../../../../../schema/schema.graphql', import.meta.url)), 'utf8'));

function writeEvent(fields: Record<string, string>, impersonation: unknown = null) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return { request: { formData: async () => fd }, params: { appId: 'app-1', taskId: 't1' }, locals: { token: 'tok', user: { id: 'u1' }, impersonation } } as never;
}
const actions = async () => (await import('./[taskId]/+page.server')).actions as Record<string, (e: never) => Promise<unknown>>;

beforeEach(() => { request.mockReset(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('DISPOSE_AGENT_TASK_FINDING_MUTATION', () => {
  it('is valid against the pinned SDL and names exactly the server arguments', () => {
    expect(DISPOSE_AGENT_TASK_FINDING_MUTATION).toContain('disposeAgentTaskFinding(taskRef: $taskRef, findingId: $findingId, disposition: $disposition, reference: $reference)');
    const out = graphql({ schema, source: DISPOSE_AGENT_TASK_FINDING_MUTATION, variableValues: {}, rootValue: {} });
    return expect(out).resolves.not.toMatchObject({ errors: expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/Cannot query|Unknown (argument|type)|Variable .* of type/) })]) });
  });
});

describe('the disposition surfaces against the pinned SDL', () => {
  it.each([
    ['AGENT_TASKS_BOARD_QUERY', AGENT_TASKS_BOARD_QUERY],
    ['AGENT_TASK_FINDING_DISPOSITIONS_QUERY', AGENT_TASK_FINDING_DISPOSITIONS_QUERY],
  ])('%s has no validation errors', (_name, source) => {
    expect(validate(schema, parse(source)).map((e) => e.message)).toEqual([]);
  });
  it('the dispositions read sizes its limit from the provider maximum, not a literal', () => {
    expect(AGENT_TASK_FINDING_DISPOSITIONS_QUERY).toContain('findingDispositions(limit: $limit, offset: $offset)');
    expect(AGENT_TASK_FINDING_DISPOSITIONS_QUERY).not.toMatch(/limit:\s*\d/);
  });
});

describe('disposeFinding action', () => {
  it.each(['fixed', 'accepted', 'deferred', 'rejected'])('records %s through disposeAgentTaskFinding with the route’s task and no reference', async (code) => {
    request.mockResolvedValue({ disposeAgentTaskFinding: { id: 't1' } });
    expect(await (await actions()).disposeFinding(writeEvent({ findingId: 'F2', disposition: code, references: '[]' }))).toMatchObject({ action: 'disposeFinding', ok: true });
    expect(request).toHaveBeenLastCalledWith(DISPOSE_AGENT_TASK_FINDING_MUTATION, { taskRef: 't1', findingId: 'F2', disposition: code });
  });
  it('sends the one typed reference exactly as given', async () => {
    request.mockResolvedValue({ disposeAgentTaskFinding: { id: 't1' } });
    const refs = JSON.stringify([{ kind: 'PULL_REQUEST', target: 'https://github.com/o/r/pull/9', label: 'the fix' }]);
    await (await actions()).disposeFinding(writeEvent({ findingId: 'F2', disposition: 'fixed', references: refs }));
    expect(request).toHaveBeenLastCalledWith(DISPOSE_AGENT_TASK_FINDING_MUTATION, { taskRef: 't1', findingId: 'F2', disposition: 'fixed', reference: { kind: 'PULL_REQUEST', target: 'https://github.com/o/r/pull/9', label: 'the fix' } });
  });
  it.each([
    ['TASK_NOT_OWNER', 403], ['TASK_NOT_FINISHED', 409], ['TASK_FINDING_NOT_FOUND', 404],
  ])('%s comes back as a %i refusal with the server’s sentence and the reader’s values, never a success', async (code, status) => {
    request.mockRejectedValueOnce(gqlError(code, `server says ${code}`));
    const r = (await (await actions()).disposeFinding(writeEvent({ findingId: 'F2', disposition: 'accepted', references: '[]' }))) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(status);
    expect(r.data).toMatchObject({ action: 'disposeFinding', refusal: { kind: 'refused', code, message: `server says ${code}` } });
    expect(r.data.ok).toBeUndefined();
  });
  it('an unknown failure is the uncertain line, never the raw text', async () => {
    request.mockRejectedValueOnce(new Error('connect ECONNRESET secret-host'));
    const r = (await (await actions()).disposeFinding(writeEvent({ findingId: 'F2', disposition: 'fixed', references: '[]' }))) as { data: { refusal: unknown } };
    expect(r.data.refusal).toEqual({ kind: 'uncertain' });
  });
  it('asks the server nothing for no code, an unknown code, no finding, or two references', async () => {
    const two = JSON.stringify([{ kind: 'URL', target: 'https://a.test/' }, { kind: 'URL', target: 'https://b.test/' }]);
    for (const f of [{ findingId: 'F2' }, { findingId: 'F2', disposition: 'cleared' }, { disposition: 'fixed' }, { findingId: 'F2', disposition: 'fixed', references: two }]) {
      const r = (await (await actions()).disposeFinding(writeEvent(f as Record<string, string>))) as { status: number };
      expect(r.status).toBe(400);
    }
    expect(request).not.toHaveBeenCalled();
  });
  it('writes nothing in an impersonation session', async () => {
    const r = (await (await actions()).disposeFinding(writeEvent({ findingId: 'F2', disposition: 'fixed', references: '[]' }, { id: 'someone' }))) as { status: number };
    expect(r.status).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });
});

const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ findingId: `F${i + 1}`, disposition: i % 2 ? 'fixed' : 'deferred', reference: i === 0 ? { kind: 'ISSUE', target: 'https://github.com/o/r/issues/1', label: null } : null }));
function provider(opts: { rows?: ReturnType<typeof rowsOf>; task?: 'null' | 'other-app' } = {}) {
  const rows = opts.rows ?? rowsOf(450);
  return async (doc: string, vars: Record<string, unknown>) => {
    expect(doc).toBe(AGENT_TASK_FINDING_DISPOSITIONS_QUERY);
    if (opts.task === 'null') return { agentTask: null };
    const out = await graphql({ schema, source: doc, variableValues: vars, rootValue: { agentTask: () => ({
      id: vars.id, appId: opts.task === 'other-app' ? 'other' : app.id,
      findingDispositions: ({ limit, offset }: { limit: number; offset: number }) => {
        const items = rows.slice(offset, offset + limit);
        return { items, total: rows.length, hasMore: offset + items.length < rows.length };
      },
    }) } });
    expect(out.errors).toBeUndefined();
    return out.data;
  };
}

describe('taskDispositions', () => {
  it('walks the separate paged read in full (200 a page) and returns every row with the true total', async () => {
    const c = { request: vi.fn(provider()) };
    const out = await taskDispositions(c as never, 'app-1', 'canonical');
    expect(c.request.mock.calls.map(([, v]) => (v as { offset: number }).offset)).toEqual([0, 200, 400]);
    expect(out).toMatchObject({ kind: 'ok', total: 450 });
    expect(out.kind === 'ok' && out.items).toHaveLength(450);
    expect(out.kind === 'ok' && out.items[0]).toEqual({ findingId: 'F1', disposition: 'deferred', reference: { kind: 'ISSUE', target: 'https://github.com/o/r/issues/1', label: null } });
  });
  it('a task with no dispositions is a valid empty set, distinct from a failed read', async () => {
    expect(await taskDispositions({ request: vi.fn(provider({ rows: [] })) } as never, 'app-1', 'canonical')).toEqual({ kind: 'ok', items: [], total: 0 });
  });
  it('a null task is the neutral unavailable; another App’s task and a fault are failed, never empty', async () => {
    expect(await taskDispositions({ request: vi.fn(provider({ task: 'null' })) } as never, 'app-1', 'canonical')).toEqual({ kind: 'unavailable' });
    expect(await taskDispositions({ request: vi.fn(provider({ task: 'other-app' })) } as never, 'app-1', 'canonical')).toEqual({ kind: 'failed' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await taskDispositions({ request: vi.fn().mockRejectedValue(new Error('SECRET-9f3')) } as never, 'app-1', 'canonical')).toEqual({ kind: 'failed' });
    expect(warn.mock.calls).toEqual([['[task-dispositions] read failed']]);
  });
  it('gives up as failed rather than show a partial set when the walk exceeds its page cap', async () => {
    const endless = vi.fn().mockImplementation(async (_d: string, v: { offset: number }) => ({ agentTask: { id: 'canonical', appId: 'app-1', findingDispositions: { items: rowsOf(200).map((r, i) => ({ ...r, findingId: `G${v.offset + i}` })), total: 99999, hasMore: true } } }));
    expect(await taskDispositions({ request: endless } as never, 'app-1', 'canonical')).toEqual({ kind: 'failed' });
    expect(endless).toHaveBeenCalledTimes(10);
  });
  it('a malformed page or a repeated finding across pages is failed', async () => {
    const dup = vi.fn().mockImplementation(async (_d: string, v: { offset: number }) => ({ agentTask: { id: 'canonical', appId: 'app-1', findingDispositions: { items: [{ findingId: 'F1', disposition: 'fixed', reference: null }], total: 2, hasMore: v.offset === 0 } } }));
    expect(await taskDispositions({ request: dup } as never, 'app-1', 'canonical')).toEqual({ kind: 'failed' });
  });
});

describe('taskDispositions completeness', () => {
  it('a final page that holds fewer rows than the declared total is failed, never a partial ok', async () => {
    const short = vi.fn().mockResolvedValue({ agentTask: { id: 'canonical', appId: 'app-1', findingDispositions: { items: [{ findingId: 'F1', disposition: 'fixed', reference: null }], total: 2, hasMore: false } } });
    expect(await taskDispositions({ request: short } as never, 'app-1', 'canonical')).toEqual({ kind: 'failed' });
  });
});

describe('dispositions endpoint', () => {
  const ev = () => ({ locals: { token: 'viewer' }, params: { appId: 'app-1', taskId: 'AT1' } }) as never;
  it('answers no-store; a readable task is the set, an unreadable one the same neutral 404', async () => {
    request.mockImplementation(provider({ rows: rowsOf(3) }));
    const ok = await GET(ev());
    expect(ok.status).toBe(200); expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(await ok.json()).toMatchObject({ kind: 'ok', total: 3 });
    request.mockImplementation(provider({ task: 'null' }));
    const gone = await GET(ev());
    expect(gone.status).toBe(404); expect(gone.headers.get('cache-control')).toBe('no-store');
  });
  it('a fault while resolving the task is 200 {kind:failed} and never echoes the fault', async () => {
    request.mockRejectedValue(new Error('SECRET-MARKER-1'));
    const res = await GET(ev());
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ kind: 'failed' });
    expect(body).not.toContain('SECRET-MARKER-1');
  });
});
