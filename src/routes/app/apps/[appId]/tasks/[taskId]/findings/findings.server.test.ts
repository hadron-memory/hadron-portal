import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import { AGENT_TASKS_APP_QUERY, AGENT_TASK_FINDINGS_QUERY, AGENT_TASK_REF_QUERY } from '$lib/server/queries';
import { OPTIONAL_LIST_TIMEOUT_MS } from '$lib/server/with-timeout';

const request = vi.fn();
const gqlClient = vi.fn((_token: unknown) => ({ request }));
vi.mock('$lib/server/api', () => ({ gqlClient: (...args: unknown[]) => gqlClient(args[0]) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:example.com:team', organizationId: null };
const finding = { id: 'F1', severity: 'P2', text: '<script>literal</script>' };
function answer(query: string, body: unknown = { items: [finding], total: 1, hasMore: false }) {
  request.mockImplementation(async (q: string) => {
    if (q === AGENT_TASKS_APP_QUERY) return { app };
    if (q === AGENT_TASK_REF_QUERY) return { agentTask: { id: 'canonical', appId: app.id } };
    if (q === AGENT_TASK_FINDINGS_QUERY) return { agentTask: { id: 'canonical', result: { findings: body } } };
    throw new Error(`unexpected query ${query}`);
  });
}
function event(offset?: string, token: unknown = 'viewer') {
  const suffix = offset === undefined ? '' : `?offset=${encodeURIComponent(offset)}`;
  return { locals: { token }, params: { appId: app.id, taskId: 'AT1.7' }, url: new URL(`http://localhost/findings${suffix}`) } as never;
}

beforeEach(() => { request.mockReset(); gqlClient.mockClear(); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('task findings section endpoint (portal#1637)', () => {
  it('resolves the route under the viewer token and returns one canonical page, privately', async () => {
    answer(AGENT_TASK_FINDINGS_QUERY, { items: [finding], total: 21, hasMore: false });
    const response = await GET(event('20'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ kind: 'page', value: { taskId: 'canonical', offset: 20, items: [finding], total: 21, hasMore: false } });
    expect(gqlClient).toHaveBeenCalledWith('viewer');
    expect(request).toHaveBeenCalledWith(AGENT_TASK_FINDINGS_QUERY, { id: 'canonical', limit: 20, offset: 20 });
  });

  it('defaults only an omitted offset to zero', async () => {
    answer(AGENT_TASK_FINDINGS_QUERY, { items: [], total: 0, hasMore: false });
    expect(await (await GET(event())).json()).toEqual({ kind: 'page', value: { taskId: 'canonical', offset: 0, items: [], total: 0, hasMore: false } });
    expect(request).toHaveBeenCalledWith(AGENT_TASK_FINDINGS_QUERY, { id: 'canonical', limit: 20, offset: 0 });
  });

  it.each(['', '-1', '+1', '1.5', '1e2', 'abc', '2147483648', '9007199254740992', ' 1'])('refuses offset %j before any provider call', async (offset) => {
    await expect(GET(event(offset))).rejects.toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
    expect(gqlClient).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller before any provider call', async () => {
    const response = await GET(event('0', null));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps an unreadable App neutral before any task or findings read', async () => {
    request.mockResolvedValueOnce({ app: null });
    await expect(GET(event('0'))).rejects.toMatchObject({ status: 404 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.some(([q]) => q === AGENT_TASK_FINDINGS_QUERY)).toBe(false);
  });

  it('keeps a cross-App task neutral and never reads its findings through this route', async () => {
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === AGENT_TASK_REF_QUERY) return { agentTask: { id: 'foreign', appId: 'app-2' } };
      throw new Error('findings must not be read');
    });
    await expect(GET(event('0'))).rejects.toMatchObject({ status: 404 });
    expect(request.mock.calls.some(([q]) => q === AGENT_TASK_FINDINGS_QUERY)).toBe(false);
  });

  it('distinguishes a later null result from an unavailable task and a failed read', async () => {
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === AGENT_TASK_REF_QUERY) return { agentTask: { id: 'canonical', appId: app.id } };
      if (q === AGENT_TASK_FINDINGS_QUERY) return { agentTask: { id: 'canonical', result: null } };
      throw new Error('unexpected');
    });
    expect(await (await GET(event('0'))).json()).toEqual({ kind: 'no-result' });
    answer(AGENT_TASK_FINDINGS_QUERY);
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === AGENT_TASK_REF_QUERY) return { agentTask: { id: 'canonical', appId: app.id } };
      return { agentTask: null };
    });
    expect(await (await GET(event('0'))).json()).toEqual({ kind: 'unavailable' });
    answer(AGENT_TASK_FINDINGS_QUERY);
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === AGENT_TASK_REF_QUERY) return { agentTask: { id: 'canonical', appId: app.id } };
      throw new Error('private database detail');
    });
    expect(await (await GET(event('0'))).json()).toEqual({ kind: 'failed' });
  });

  it('returns a typed failure after the optional 8s bound', async () => {
    vi.useFakeTimers();
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === AGENT_TASK_REF_QUERY) return { agentTask: { id: 'canonical', appId: app.id } };
      return new Promise(() => {});
    });
    const pending = GET(event('0'));
    await vi.advanceTimersByTimeAsync(OPTIONAL_LIST_TIMEOUT_MS);
    expect(await (await pending).json()).toEqual({ kind: 'failed' });
  });
});
