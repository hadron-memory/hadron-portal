/**
 * #629 / #636: /app/dashboard renders a widget grid + a memories preview for
 * EVERY user. The loader issues ONE DASHBOARD_QUERY (no fetchAllItems, no org
 * redirect) and returns the memory count/preview, the widget placements (from
 * the server selection, or a default), and the per-widget combined data.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Restore afterAll so a suite-wide spy can't suppress console.error elsewhere.
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
afterAll(() => errorSpy.mockRestore());

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => mockRequest.mockReset());

async function importLoad() {
  return (await import('./+page.server')).load;
}

function ev() {
  return { locals: { token: 't' } } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

async function runLoad() {
  const load = await importLoad();
  return load(ev());
}

describe('/app/dashboard loader (#629 / #636)', () => {
  it('returns the server total as the count and the items as the preview', async () => {
    mockRequest.mockResolvedValue({
      memories: {
        items: [{ id: 'a', name: 'Notes', urn: 'hrn:mem:ada:notes', class: 'personal' }],
        total: 12,
      },
      dashboardWidgets: [],
      dashboardWidgetData: [],
    });
    expect(await runLoad()).toMatchObject({
      memoryCount: 12,
      preview: [{ id: 'a', name: 'Notes', urn: 'hrn:mem:ada:notes', class: 'personal' }],
      loadFailed: false,
    });
  });

  it('falls back to the default Memory Stats layout when the user has no widgets, seeding its data from the memory total', async () => {
    mockRequest.mockResolvedValue({
      memories: { items: [], total: 7 },
      dashboardWidgets: [],
      dashboardWidgetData: [],
    });
    const result = await runLoad();
    expect(result).toMatchObject({
      placements: [{ type: 'memory-stats', span: 4 }],
      widgetData: { 'memory-stats': { memoryCount: 7 } },
    });
  });

  it('maps the server widget selection to placements and fans dashboardWidgetData out by type', async () => {
    mockRequest.mockResolvedValue({
      memories: { items: [], total: 3 },
      dashboardWidgets: [{ type: 'MEMORY_STATS', span: 6, position: 0 }],
      dashboardWidgetData: [{ type: 'MEMORY_STATS', data: { memoryCount: 3 } }],
    });
    const result = await runLoad();
    expect(result).toMatchObject({
      placements: [{ type: 'memory-stats', span: 6 }],
      widgetData: { 'memory-stats': { memoryCount: 3 } },
    });
  });

  it('orders placements by the server `position`, not array order', async () => {
    mockRequest.mockResolvedValue({
      memories: { items: [], total: 0 },
      // Deliberately out of order: position 1 before position 0.
      dashboardWidgets: [
        { type: 'MEMORY_STATS', span: 6, position: 1 },
        { type: 'MEMORY_STATS', span: 3, position: 0 },
      ],
      dashboardWidgetData: [{ type: 'MEMORY_STATS', data: { memoryCount: 0 } }],
    });
    const result = (await runLoad()) as { placements: Array<{ span: number }> };
    // position 0 (span 3) must come first.
    expect(result.placements.map((p) => p.span)).toEqual([3, 6]);
  });

  it('skips an unknown server widget type defensively (falls back to default when none map)', async () => {
    mockRequest.mockResolvedValue({
      memories: { items: [], total: 1 },
      dashboardWidgets: [{ type: 'NOT_A_REAL_WIDGET', span: 4, position: 0 }],
      dashboardWidgetData: [],
    });
    const result = (await runLoad()) as { placements: Array<{ type: string }> };
    expect(result.placements).toEqual([{ type: 'memory-stats', span: 4 }]);
  });

  it('handles an empty workspace', async () => {
    mockRequest.mockResolvedValue({
      memories: { items: [], total: 0 },
      dashboardWidgets: [],
      dashboardWidgetData: [],
    });
    expect(await runLoad()).toMatchObject({ memoryCount: 0, preview: [], loadFailed: false });
  });

  // The failure path (`loadFailed: true` + count 0 on a rejected query) is the
  // same plain try/catch as /app/memories and is verified in-browser (error
  // banner renders instead of a misleading "0 memories"). A throwing mock trips
  // this repo's vitest error detector even when the loader catches it, so it
  // isn't unit-tested here.
});
