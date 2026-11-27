import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route the picker reads as the user types and pages (portal#2674): 401 without a session, a straight pass-through to
// the server's attachableMemories door, and a failed read that never throws or carries server text.
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: (...a: unknown[]) => request(...a) }) }));
import { GET } from './attachable/+server';

const call = (locals: Record<string, unknown>, qs = '') =>
  GET({ params: { appId: 'app-1' }, locals, url: new URL(`http://x/app/apps/app-1/attachable${qs}`) } as never);
const signedIn = { token: 't', user: { id: 'u' } };

beforeEach(() => { request.mockReset(); });

describe('GET /app/apps/[appId]/attachable', () => {
  it('answers 401 without a token or user, and never reads', async () => {
    for (const locals of [{}, { token: 't' }, { user: { id: 'u' } }]) {
      const res = await call(locals);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ kind: 'failed', code: 'UNAUTHENTICATED' });
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('returns the server page and total, with the text and offset passed straight to the server', async () => {
    const items = [{ id: 'm1', urn: 'hrn:mem:o:m1', name: 'M1', visibility: null }];
    request.mockResolvedValue({ attachableMemories: { total: 11, items } });
    const res = await call(signedIn, '?q=m1&offset=10');
    expect(await res.json()).toEqual({ kind: 'ok', memories: items, total: 11 });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toEqual({ appRef: 'app-1', query: 'm1', limit: 10, offset: 10 });
  });

  it('clamps a bad offset to the first page and ignores a limit from the request', async () => {
    request.mockResolvedValue({ attachableMemories: { total: 0, items: [] } });
    await call(signedIn, '?offset=-5&limit=5000');
    expect(request.mock.calls[0][1]).toMatchObject({ offset: 0, limit: 10 });
    await call(signedIn, '?offset=abc');
    expect(request.mock.calls[1][1]).toMatchObject({ offset: 0 });
  });

  it('names a refusal by code only, and any other failure as FAILED, never with server text', async () => {
    request.mockRejectedValueOnce({ response: { errors: [{ message: 'SECRET', extensions: { code: 'APP_UNINSTALLED' } }] } });
    const res = await call(signedIn);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: 'failed', code: 'APP_UNINSTALLED' });
    request.mockImplementationOnce(async () => { throw new Error('SECRET server text'); });
    const text = JSON.stringify(await (await call(signedIn)).json());
    expect(text).toBe('{"kind":"failed","code":"FAILED"}');
  });
});
