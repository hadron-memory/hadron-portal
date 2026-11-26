import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route a picker reads on demand: 401 without a session, a list that is the person's readable memories whatever
// their owner or organization (portal#2635), and a failed read that never throws or carries server text.
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: (...a: unknown[]) => request(...a) }) }));
import { GET } from './attachable/+server';

const call = (locals: Record<string, unknown>, url = 'http://x/app/apps/app-1/attachable') =>
  GET({ params: { appId: 'app-1' }, locals, url: new URL(url) } as never);

beforeEach(() => { request.mockReset(); });

describe('GET /app/apps/[appId]/attachable', () => {
  it('answers 401 without a token or user, and never reads', async () => {
    for (const locals of [{}, { token: 't' }, { user: { id: 'u' } }]) {
      const res = await call(locals);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ kind: 'failed' });
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('lists every memory the caller reads, asking for no organization or owner and ignoring one in the request', async () => {
    request.mockResolvedValue({ memories: { total: 2, items: [
      { id: 'm1', urn: 'hrn:mem:o:m1', name: 'M1', visibility: null },
      { id: 'm2', urn: 'hrn:mem:p:m2', name: 'M2', visibility: 'ORGANIZATION' },
    ] } });
    const res = await call({ token: 't', user: { id: 'u' } }, 'http://x/app/apps/app-1/attachable?orgId=org-from-request');
    expect(await res.json()).toEqual({ kind: 'ok', memories: [
      { id: 'm1', urn: 'hrn:mem:o:m1', name: 'M1', visibility: null },
      { id: 'm2', urn: 'hrn:mem:p:m2', name: 'M2', visibility: 'ORGANIZATION' },
    ] });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).not.toHaveProperty('orgRef');
    expect(request.mock.calls[0][1]).not.toHaveProperty('ownedByMe');
    expect(JSON.stringify(request.mock.calls)).not.toContain('org-from-request');
  });

  it('answers failed, without server text, when a read throws', async () => {
    request.mockImplementation(async () => { throw new Error('SECRET server text'); });
    const res = await call({ token: 't', user: { id: 'u' } });
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).toBe('{"kind":"failed"}');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
