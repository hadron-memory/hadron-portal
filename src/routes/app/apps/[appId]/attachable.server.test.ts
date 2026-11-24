import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_ORG_QUERY } from './app-memories';

// The route a picker reads on demand: 401 without a session, the org taken from the App and never from the
// request, and a failed read that never throws or carries server text.
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

  it("takes the organization from the App, not from the request, and asks only for the caller's own", async () => {
    request.mockImplementation(async (query: string) => query === APP_ORG_QUERY
      ? { app: { organizationId: 'org-from-app' } }
      : { memories: { total: 1, items: [{ id: 'm1', urn: 'hrn:mem:o:m1', name: 'M1', visibility: null, appId: null, organizationId: 'org-from-app' }] } });
    const res = await call({ token: 't', user: { id: 'u' } }, 'http://x/app/apps/app-1/attachable?orgId=org-from-request');
    expect(await res.json()).toEqual({ kind: 'ok', memories: [{ id: 'm1', urn: 'hrn:mem:o:m1', name: 'M1', visibility: null }] });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(request.mock.calls[0][1]).toEqual({ ref: 'app-1' });
    expect(request.mock.calls[1][1]).toMatchObject({ orgId: 'org-from-app', ownedByMe: true });
    expect(JSON.stringify(request.mock.calls)).not.toContain('org-from-request');
  });

  it('answers failed, with status 200, for a missing App', async () => {
    request.mockResolvedValue({ app: null });
    const res = await call({ token: 't', user: { id: 'u' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: 'failed' });
    expect(request).toHaveBeenCalledTimes(1);
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
