/**
 * #266 Usage tab — tests for the per-memory usage-events loader.
 *
 * Strategy mirrors the sibling `settings/page.server.test.ts`: mock
 * `$lib/server/api`'s `gqlClient`, import `load` from `+page.server.ts`, and
 * call it with a hand-rolled SvelteKit-shaped event. No SvelteKit runtime.
 *
 * The load-bearing assertion is that the loader scopes the query to THIS
 * memory by passing `memoryId: params.id` — without it, the tab would render
 * the global usage feed (the bug that motivated hadron-server #249).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

function ev(memId: string) {
  return {
    params: { id: memId },
    locals: { token: 'test-token' },
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

async function importLoad() {
  const mod = await import('./+page.server');
  return mod.load;
}

describe('memory-detail Usage tab loader (#266)', () => {
  it('scopes the query to the memory via memoryId and returns the events', async () => {
    const events = [{ id: 'ue-1', type: 'read', nodeLoc: 'a/b', createdAt: '2026-06-01' }];
    mockRequest.mockResolvedValueOnce({ usageEvents: events });
    const load = await importLoad();

    const result = await load(ev('mem-xyz'));

    expect(result).toEqual({ events, eventsCapped: false });
    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars.memoryId).toBe('mem-xyz');
    expect(vars.limit).toBeGreaterThan(0);
  });

  it('#1226: says so when the window came back full, and not before', async () => {
    const load = await importLoad();
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `ue-${i}` }));
    mockRequest.mockResolvedValueOnce({ usageEvents: rows(200) });
    expect(((await load(ev('m'))) as { eventsCapped: boolean }).eventsCapped).toBe(true);
    mockRequest.mockResolvedValueOnce({ usageEvents: rows(199) });
    expect(((await load(ev('m'))) as { eventsCapped: boolean }).eventsCapped).toBe(false);
  });
});
