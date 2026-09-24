/**
 * #855 (@codex on #908) — the worker roster the team chat re-reads when a
 * polled message comes from a worker the page has never seen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKERS_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

async function get(appId = 'app-1') {
  const { GET } = await import('./+server');
  const res = await GET({ params: { appId }, locals: { token: 'tok' } } as never);
  return { status: res.status, body: await res.json() };
}

describe('GET /app/apps/[appId]/team-chat/authors', () => {
  it('returns every rostered worker as { id, urn }, retired included — a null URN kept as null, not dropped', async () => {
    mockRequest.mockResolvedValue({
      workers: {
        items: [
          { id: 'w1', urn: 'hrn:worker:acme.com:team:dara' },
          { id: 'w2', urn: null },
        ],
        total: 2,
      },
    });
    const r = await get();
    expect(r).toEqual({
      status: 200,
      body: {
        workers: [
          { id: 'w1', urn: 'hrn:worker:acme.com:team:dara' },
          { id: 'w2', urn: null },
        ],
        loadFailed: false,
      },
    });
    const [query, vars] = mockRequest.mock.calls[0] as [string, Record<string, unknown>];
    expect(query).toBe(WORKERS_QUERY);
    expect(vars).toMatchObject({ appRef: 'app-1', includeRetired: true });
  });

  it('degrades with 200 + loadFailed — it feeds a background refresh, never the page', async () => {
    mockRequest.mockRejectedValue(new Error('roster down'));
    expect(await get()).toEqual({ status: 200, body: { workers: [], loadFailed: true } });
  });
});
