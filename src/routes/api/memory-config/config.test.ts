import { beforeEach, describe, expect, it, vi } from 'vitest';
const request = vi.fn(), client = vi.fn((..._args: unknown[]) => ({ request }));
vi.mock('$lib/server/api', () => ({ gqlClient: (...args: unknown[]) => client(...args) }));
import { POST } from './+server';
const url = new URL('http://localhost/api/memory-config');
function event(body: unknown, impersonation: unknown = null, token: string | null = 'caller-one', origin = url.origin) {
  return { url, request: new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) }), locals: { token, impersonation } } as Parameters<typeof POST>[0];
}
beforeEach(() => { request.mockReset(); client.mockClear(); });
describe('config endpoint', () => {
  it('requires authentication and same-origin before any provider call', async () => {
    expect((await POST(event({}, null, null))).status).toBe(401);
    expect((await POST(event({}, null, 'token', 'https://elsewhere.test'))).status).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });
  it.each(['create', 'update', 'delete', 'unlock', 'preview', 'apply'])('impersonation refuses %s before any provider call', async op => {
    const response = await POST(event({ kind: op === 'apply' || op === 'preview' ? 'apply' : 'rules', op, memoryRef: 'm', ref: 'r', revision: 4, input: { role: 'review' } }, { sessionId: 'imp' }));
    expect(response.status).toBe(403); expect(request).not.toHaveBeenCalled();
  });
  it('preserves the intentional RULE_LOCKED text for a non-admin user owner', async () => {
    request.mockRejectedValue({ response: { errors: [{ message: 'Only an org admin can unlock this rule.', extensions: { code: 'RULE_LOCKED' } }] } });
    const result = await POST(event({ kind: 'rules', op: 'unlock', memoryRef: 'org-memory', ref: 'locked-rule', revision: 3 }));
    expect(await result.json()).toMatchObject({ code: 'RULE_LOCKED', error: 'Only an org admin can unlock this rule.' });
  });
  it('keeps field refusal classification, while internal messages use the safe envelope', async () => {
    request.mockRejectedValueOnce({ response: { errors: [{ message: 'Choose a runnable task.', extensions: { code: 'NOT_A_TASK', field: 'authorTask' } }] } });
    const body = { kind: 'rules', op: 'create', memoryRef: 'm', input: { role: 'review', authorTaskRef: 'node' } };
    expect(await (await POST(event(body))).json()).toMatchObject({ code: 'NOT_A_TASK', field: 'authorTask', error: 'Choose a runnable task.' });
    request.mockRejectedValueOnce({ response: { errors: [{ message: 'private SQL detail', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] } });
    expect(JSON.stringify(await (await POST(event(body))).json())).not.toContain('private SQL');
  });
  it('sends every stored setting without refusing settings whose enforcement is pending', async () => {
    request.mockResolvedValue({});
    const input = { role: 'review', writers: 'OWNER', strictSubRoles: true, validateBy: 'AGENT', validationTaskRef: 'task', enabled: true };
    expect((await POST(event({ kind: 'rules', op: 'create', memoryRef: 'm', input }))).status).toBe(200);
    expect(request.mock.calls[0][1].input).toEqual(input);
  });
  it('uses this caller token and does not cache reads across principals', async () => {
    request.mockResolvedValueOnce({ memory: { config: { id: 'config', rules: [] } } }).mockResolvedValueOnce({ memory: { config: null } });
    const body = { kind: 'rules', op: 'read', memoryRef: 'm' };
    expect((await (await POST(event(body, null, 'owner'))).json()).value).not.toBeNull();
    const second = await POST(event(body, null, 'reader'));
    expect((await second.json()).value).toBeNull(); expect(second.headers.get('cache-control')).toBe('private, no-store');
    expect(client.mock.calls).toEqual([['owner'], ['reader']]);
  });
  it('names the reference field from the refused caller-supplied ref, without a discovery read', async () => {
    request.mockRejectedValue({ response: { errors: [{ message: 'Node not found.', extensions: { code: 'NODE_NOT_FOUND', ref: 'chosen-node' } }] } });
    const response = await POST(event({ kind: 'rules', op: 'create', memoryRef: 'm', input: { role: 'review', descriptionNodeRef: 'chosen-node' } }));
    expect(await response.json()).toMatchObject({ code: 'NODE_NOT_FOUND', field: 'descriptionNode' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  describe('bulk apply', () => {
    const preview = { kind: 'bulk', op: 'preview', ref: 't', memoryRefs: ['m1', 'm2'] };
    const apply = { ...preview, op: 'apply', revision: 9 };
    const refused = (code: string, message: string, extra = {}) => ({ response: { errors: [{ message, extensions: { code, ...extra } }] } });
    it('passes every chosen ref through and never truncates a list over the cap', async () => {
      const memoryRefs = Array.from({ length: 51 }, (_, i) => `m${i}`);
      request.mockRejectedValue(refused('BULK_TARGETS_TOO_MANY', 'At most 50 targets, got 51.', { max: 50, count: 51 }));
      const response = await POST(event({ ...preview, memoryRefs }));
      expect(request.mock.calls[0][1].memoryRefs).toEqual(memoryRefs);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'BULK_TARGETS_TOO_MANY', max: 50, count: 51 });
    });
    it('impersonation refuses before any provider call', async () => {
      for (const body of [preview, apply]) expect((await POST(event(body, { sessionId: 'imp' }))).status).toBe(403);
      expect(request).not.toHaveBeenCalled();
    });
    it('needs a revision to apply: a real apply is never sent unbound', async () => {
      expect((await POST(event({ ...preview, op: 'apply' }))).status).toBe(400);
      expect(request).not.toHaveBeenCalled();
    });
    it.each([['UNAUTHENTICATED', 400], ['FORBIDDEN', 400], ['BAD_USER_INPUT', 400], ['MEMORY_CONFIG_TEMPLATE_NOT_FOUND', 400], ['CONFLICT', 409]])('reports whole-call %s as a refusal', async (code, status) => {
      request.mockRejectedValue(refused(code, `refused ${code}`, code === 'CONFLICT' ? { currentRevision: 10 } : {}));
      const response = await POST(event(apply));
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code, error: `refused ${code}` });
    });
    it.each([
      ['a transport loss', new TypeError('fetch failed')],
      ['a 5xx with no result body', { response: { status: 503 } }],
      ['a whole-call internal fault', refused('INTERNAL_SERVER_ERROR', 'private SQL detail', { requestId: 'x' })],
      ['a code that does not prove nothing was written', refused('SOME_NEW_CODE', 'private detail')],
    ])('never reports %s as a refusal, because targets may have committed', async (_name, failure) => {
      request.mockRejectedValue(failure);
      const response = await POST(event(apply));
      expect(response.status).toBe(502);
      const text = JSON.stringify(await response.json());
      expect(text).not.toMatch(/"code"/); expect(text).not.toContain('private');
    });
  });
  it('rejects malformed rule input before GraphQL', async () => {
    expect((await POST(event({ kind: 'rules', op: 'create', memoryRef: 'm', input: [] }))).status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });
});
