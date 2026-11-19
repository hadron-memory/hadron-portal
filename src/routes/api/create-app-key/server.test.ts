/**
 * portal#1068 — POST /api/create-app-key, the Client tab's "Download setup
 * files" mint. A manager refusal is a 403 naming the rule, with the same copy
 * as the App Keys tab, rather than a 500 carrying the raw server text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_KEY_IMPERSONATION_READ_ONLY, APP_KEY_MANAGERS_ONLY } from '$lib/server/app-key-refusal';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

function ev(body: unknown, token: string | null = 'tok') {
  return { request: { json: async () => body }, locals: { token } } as never;
}

beforeEach(() => {
  mockRequest.mockReset();
});

describe('POST /api/create-app-key', () => {
  it('returns the minted key', async () => {
    mockRequest.mockResolvedValueOnce({
      createAppKey: { key: { id: 'k1', label: 'dev', createdAt: 'x' }, rawKey: 'hdr_app_x' },
    });
    const { POST } = await import('./+server');
    const res = await POST(ev({ appId: 'a1', label: 'dev' }));
    expect(res.status).toBe(200);
    expect((await res.json()).rawKey).toBe('hdr_app_x');
  });

  it('a FORBIDDEN refusal is a 403 with the manager copy', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] },
    });
    const { POST } = await import('./+server');
    const res = await POST(ev({ appId: 'a1', label: 'dev' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: APP_KEY_MANAGERS_ONLY() });
  });

  it('an impersonation refusal is a 403 and carries no key', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'read-only', extensions: { code: 'IMPERSONATION_READ_ONLY' } }] },
    });
    const { POST } = await import('./+server');
    const res = await POST(ev({ appId: 'a1', label: 'dev' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: APP_KEY_IMPERSONATION_READ_ONLY() });
  });

  it('a transport failure stays a 500 with the fallback copy, not the raw text', async () => {
    mockRequest.mockRejectedValueOnce(new Error('boom'));
    const { POST } = await import('./+server');
    const res = await POST(ev({ appId: 'a1', label: 'dev' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to create app key' });
  });
});
