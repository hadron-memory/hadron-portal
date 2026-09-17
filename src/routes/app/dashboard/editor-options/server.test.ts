/**
 * #666/#806: the lazily-fetched editor option lists — scope-picker memories
 * (paged through the caller's full readable set; Codex on #666) plus the
 * caller's saved widget presets, degrading to an explicit loadFailed payload
 * rather than a 500 (the editor still works with "My activity" + stored refs).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
afterAll(() => errorSpy.mockRestore());

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockRequest.mockReset();
});

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

describe('GET /app/dashboard/editor-options (#666/#806)', () => {
  it('returns a single short page as-is, projected to id+name, plus mapped presets', async () => {
    mockRequest
      .mockResolvedValueOnce(page(0, 3, 3))
      .mockResolvedValueOnce({
        dashboardWidgetPresets: [
          { id: 'p1', type: 'USAGE_ACTIVITY', name: 'Team 30d', config: { windowDays: 30 } },
          { id: 'p2', type: 'NOT_A_REAL_TYPE', name: 'stale', config: {} },
        ],
      });
    const { status, body } = await runGet();
    expect(status).toBe(200);
    expect(body.options).toEqual([
      { id: 'm0', name: 'Memory 0' },
      { id: 'm1', name: 'Memory 1' },
      { id: 'm2', name: 'Memory 2' },
    ]);
    expect(body).toMatchObject({ truncated: false, loadFailed: false });
    // Presets mapped to portal ids; unknown server types dropped.
    expect(body.presets).toEqual([
      { id: 'p1', type: 'usage-activity', name: 'Team 30d', config: { windowDays: 30 } },
    ]);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('pages past the first 100 rows until the set is exhausted', async () => {
    mockRequest
      .mockResolvedValueOnce(page(0, 100, 150))
      .mockResolvedValueOnce(page(100, 50, 150))
      .mockResolvedValueOnce({ dashboardWidgetPresets: [] });
    const { body } = await runGet();
    expect(body.options).toHaveLength(150);
    expect(body.options[149]).toEqual({ id: 'm149', name: 'Memory 149' });
    expect(mockRequest).toHaveBeenCalledTimes(3);
    // Offsets advanced by page size (presets call carries no variables).
    expect(mockRequest.mock.calls.slice(0, 2).map((c) => c[1])).toEqual([
      { limit: 100, offset: 0 },
      { limit: 100, offset: 100 },
    ]);
  });

  it('degrades to an explicit loadFailed payload when the memory pages fail', async () => {
    mockRequest
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ dashboardWidgetPresets: [] });
    const { status, body } = await runGet();
    expect(status).toBe(200);
    expect(body).toMatchObject({ options: [], presets: [], loadFailed: true, presetsFailed: false });
  });

  it('keeps the loaded memory options when only the presets query fails', async () => {
    // The two lists degrade independently (Codex/Copilot on #671) — a preset
    // hiccup must not blank the unrelated scope picker.
    mockRequest
      .mockResolvedValueOnce(page(0, 3, 3))
      .mockRejectedValueOnce(new Error('presets boom'));
    const { status, body } = await runGet();
    expect(status).toBe(200);
    expect(body.options).toHaveLength(3);
    expect(body).toMatchObject({ presets: [], loadFailed: false, presetsFailed: true });
  });
});
