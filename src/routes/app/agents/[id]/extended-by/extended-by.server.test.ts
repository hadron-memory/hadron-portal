import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import { AGENT_EXTENSIONS_QUERY } from '$lib/server/agent-profile';
import { OPTIONAL_LIST_TIMEOUT_MS } from '$lib/server/with-timeout';
const request = vi.fn(); const gqlClient = vi.fn(() => ({ request }));
vi.mock('$lib/server/api', () => ({ gqlClient: (...args: unknown[]) => { void args; return gqlClient(); } }));

const page = (items: Array<{ id: string; name: string; urn: string }>, hasMore = false, endCursor: string | null = null) =>
  ({ agent: { extendedBy: { items, hasMore, endCursor } } });

beforeEach(() => { request.mockReset(); gqlClient.mockClear(); });

function event(after?: string) {
  const url = new URL(after === undefined ? 'http://localhost/extended-by' : `http://localhost/extended-by?after=${encodeURIComponent(after)}`);
  return { locals: { token: 'viewer' }, params: { id: 'agent-7' }, url } as never;
}

describe('extended-by section endpoint (#1503)', () => {
  it('answers with the loader-shaped page for the route ref and cursor', async () => {
    request.mockResolvedValue(page([{ id: 'c', name: 'Child', urn: 'hrn:agent:example.com:c' }], true, 'opaque+/='));
    const response = await GET(event('opaque+/='));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ items: [{ id: 'c', name: 'Child', urn: 'hrn:agent:example.com:c' }], endCursor: 'opaque+/=', hasMore: true, failed: false });
    expect(request).toHaveBeenCalledWith(AGENT_EXTENSIONS_QUERY, { ref: 'agent-7', after: 'opaque+/=' });
  });

  it('reads the first page when no after cursor is present', async () => {
    request.mockResolvedValue(page([], false, null));
    const response = await GET(event());
    expect(await response.json()).toEqual({ items: [], endCursor: null, hasMore: false, failed: false });
    expect(request).toHaveBeenCalledWith(AGENT_EXTENSIONS_QUERY, { ref: 'agent-7', after: null });
  });

  it('a failed or unreadable extension page answers failed, not an HTTP error', async () => {
    request.mockResolvedValue({ agent: null });
    expect(await (await GET(event())).json()).toEqual({ items: [], endCursor: null, hasMore: false, failed: true });
    request.mockRejectedValue(new Error('transient'));
    expect(await (await GET(event())).json()).toEqual({ items: [], endCursor: null, hasMore: false, failed: true });
  });

  it('refuses an unauthenticated caller before any upstream read', async () => {
    const response = await GET({ locals: { token: null }, params: { id: 'agent-7' }, url: new URL('http://localhost/extended-by') } as never);
    expect(response.status).toBe(401);
    expect(request).not.toHaveBeenCalled();
  });

  it('settles a wedged upstream read to the failed page after the optional-list bound', async () => {
    vi.useFakeTimers();
    try {
      request.mockImplementation(() => new Promise(() => { /* wedged */ }));
      const pending = GET(event());
      await vi.advanceTimersByTimeAsync(OPTIONAL_LIST_TIMEOUT_MS);
      expect(await (await pending).json()).toEqual({ items: [], endCursor: null, hasMore: false, failed: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
