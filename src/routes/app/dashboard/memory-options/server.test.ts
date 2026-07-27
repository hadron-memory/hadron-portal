/**
 * #666: the lazily-fetched option list for the usage-activity scope picker.
 * Pages through the caller's full readable memory set (Codex on #666 — a
 * single capped page made memories past it unselectable), degrading to an
 * explicit loadFailed payload rather than a 500 (the picker still works with
 * "My activity" + the stored ref).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
afterAll(() => errorSpy.mockRestore());

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => mockRequest.mockReset());

function ev() {
  return { locals: { token: 't' } } as unknown as Parameters<
    Awaited<ReturnType<typeof importGet>>
  >[0];
}

async function importGet() {
  return (await import('./+server')).GET;
}

async function runGet() {
  const GET = await importGet();
  const res = await GET(ev());
  return { status: res.status, body: await res.json() };
}

const page = (start: number, count: number, total: number) => ({
  memories: {
    items: Array.from({ length: count }, (_, i) => ({
      id: `m${start + i}`,
      name: `Memory ${start + i}`,
      urn: `should-be-stripped-${start + i}`,
    })),
    total,
  },
});

describe('GET /app/dashboard/memory-options (#666)', () => {
  it('returns a single short page as-is, projected to id+name', async () => {
    mockRequest.mockResolvedValueOnce(page(0, 3, 3));
    const { status, body } = await runGet();
    expect(status).toBe(200);
    expect(body.options).toEqual([
      { id: 'm0', name: 'Memory 0' },
      { id: 'm1', name: 'Memory 1' },
      { id: 'm2', name: 'Memory 2' },
    ]);
    expect(body).toMatchObject({ truncated: false, loadFailed: false });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('pages past the first 100 rows until the set is exhausted', async () => {
    mockRequest
      .mockResolvedValueOnce(page(0, 100, 150))
      .mockResolvedValueOnce(page(100, 50, 150));
    const { body } = await runGet();
    expect(body.options).toHaveLength(150);
    expect(body.options[149]).toEqual({ id: 'm149', name: 'Memory 149' });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    // Offsets advanced by page size.
    expect(mockRequest.mock.calls.map((c) => c[1])).toEqual([
      { limit: 100, offset: 0 },
      { limit: 100, offset: 100 },
    ]);
  });

  it('degrades to an explicit loadFailed payload on a GraphQL error', async () => {
    mockRequest.mockRejectedValueOnce(new Error('boom'));
    const { status, body } = await runGet();
    expect(status).toBe(200);
    expect(body).toMatchObject({ options: [], loadFailed: true });
  });
});
