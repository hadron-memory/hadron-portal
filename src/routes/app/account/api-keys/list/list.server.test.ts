// #1653 QA P2 (Colette, e7ccec27): the key list's own re-read after a
// confirmed delete. A failed __data.json from invalidateAll() is rendered by
// kit as the error page over the whole page, so the Delete dialog's catch
// never ran; this endpoint is the re-read the page owns instead
// (hrn:node:hadronmemory.com:hadron-portal:findings:section-retry-owns-its-re-read).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import { MY_USER_API_KEYS_QUERY } from '$lib/server/queries';
const request = vi.fn(); const gqlClient = vi.fn((_token: unknown) => ({ request }));
vi.mock('$lib/server/api', () => ({ gqlClient: (...args: unknown[]) => gqlClient(args[0]) }));

const key = (id: string) => ({ id, keyPreview: `pv${id}`, label: null, createdAt: '2026-10-28T00:00:00Z', lastUsedAt: null, revokedAt: null, hiddenAt: null, issuedVia: 'portal' });
const page = (items: unknown[]) => ({ myUserApiKeysPage: { items, total: items.length, hasMore: false } });

beforeEach(() => { request.mockReset(); gqlClient.mockClear(); });

const event = (query = '', token: string | null = 'viewer') =>
  ({ locals: { token }, url: new URL(`http://localhost/app/account/api-keys/list${query}`) }) as never;

describe('api-keys list endpoint (#1653 QA P2)', () => {
  it('answers with every key of the asked view, with the caller\'s token, never cached', async () => {
    request.mockResolvedValue(page([key('a'), key('b')]));
    const response = await GET(event('?includeHidden=true'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ keys: [key('a'), key('b')] });
    expect(gqlClient).toHaveBeenCalledWith('viewer');
    expect(request).toHaveBeenCalledWith(MY_USER_API_KEYS_QUERY, expect.objectContaining({ includeHidden: true }));
  });

  it('reads the visible view unless includeHidden is exactly true', async () => {
    request.mockResolvedValue(page([]));
    for (const q of ['', '?includeHidden=false', '?includeHidden=1']) {
      request.mockClear();
      await GET(event(q));
      expect(request).toHaveBeenCalledWith(MY_USER_API_KEYS_QUERY, expect.objectContaining({ includeHidden: false }));
    }
  });

  it('a refused read answers failed in a 200, with no keys and no server prose', async () => {
    request.mockRejectedValue(new Error('upstream secret detail'));
    const response = await GET(event());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toEqual({ failed: true });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('refuses an unauthenticated caller before any upstream read', async () => {
    const response = await GET(event('', null));
    expect(response.status).toBe(401);
    expect(request).not.toHaveBeenCalled();
  });
});
