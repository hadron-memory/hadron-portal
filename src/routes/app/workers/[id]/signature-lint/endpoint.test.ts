import { beforeEach, describe, expect, it, vi } from 'vitest';
const { request, client } = vi.hoisted(() => ({ request: vi.fn(), client: vi.fn() }));
vi.mock('$lib/server/api', () => ({ gqlClient: client }));
import { GET } from './+server';
beforeEach(() => { request.mockReset(); client.mockReset().mockReturnValue({ request }); });
const event = (token: string | null = 'viewer-token') => ({ locals: { token }, params: { id: 'worker-a' } }) as never;
describe('portal#1685 separate masked viewer read', () => {
  it('uses only the viewer token and bounded minimal selection, no target/text or template lookup', async () => {
    request.mockResolvedValue({ worker: { signatureLint: { items: [{ kind: 'WORKER_LINK_MISSING', workerField: 'signature', text: 'PRIVATE' }], total: 1, nextCursor: null } } });
    const r = await GET(event());
    expect(client).toHaveBeenCalledWith('viewer-token'); expect(request).toHaveBeenCalledTimes(1);
    const [doc, vars] = request.mock.calls[0];
    expect(vars).toEqual({ ref: 'worker-a' });
    expect(doc).toContain('signatureLint(first: 2)');
    expect(doc).toContain('items { kind workerField } total nextCursor');
    expect(doc).not.toMatch(/\btext\b|targetUrn|position|\bsignature\b|\btrailer\b/);
    expect(await r.json()).toEqual({ workerId: 'worker-a', page: { items: [{ kind: 'WORKER_LINK_MISSING', workerField: 'signature' }], total: 1, nextCursor: null } });
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it.each([null, { signatureLint: null }])('a masked/missing worker %j stays unavailable without a second lookup', async worker => {
    request.mockResolvedValue({ worker }); const r = await GET(event());
    expect((await r.json()).page).toBeNull(); expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(['older schema', 'network'])('an unavailable %s read is sanitized, never zero', async reason => {
    request.mockRejectedValue(new Error(reason + ' secret detail'));
    const r = await GET(event()); expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ workerId: 'worker-a', page: null });
  });
  it('unauthenticated reads make no provider call', async () => {
    const r = await GET(event(null)); expect(r.status).toBe(401); expect(client).not.toHaveBeenCalled();
  });
});
