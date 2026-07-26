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
      agents: { total: 5 },
      dashboardWidgets: [],
      dashboardWidgetData: [],
    });
    expect(await runLoad()).toMatchObject({
      memoryCount: 12,
      preview: [{ id: 'a', name: 'Notes', urn: 'hrn:mem:ada:notes', class: 'personal' }],
      loadFailed: false,
    });
  });

  it('falls back to the default layout (Memory + Agent stats) when the user has no widgets, seeding data from the totals', async () => {
    mockRequest.mockResolvedValue({
      memories: { items: [], total: 7 },
      agents: { total: 3 },
      dashboardWidgets: [],
      dashboardWidgetData: [],
    });
    const result = await runLoad();
    expect(result).toMatchObject({
      placements: [
        { type: 'memory-stats', span: 4 },
        { type: 'agent-stats', span: 4 },
      ],
      widgetData: {
        'memory-stats': { memoryCount: 7 },
        'agent-stats': { agentCount: 3 },
      },
    });
  });

  it('maps the server widget selection to placements and fans dashboardWidgetData out by type', async () => {
    mockRequest.mockResolvedValue({
      memories: { items: [], total: 3 },
      agents: { total: 9 },
      dashboardWidgets: [
        { type: 'AGENT_STATS', span: 6, position: 0 },
        { type: 'MEMORY_STATS', span: 3, position: 1 },
      ],
      dashboardWidgetData: [
        { type: 'AGENT_STATS', data: { agentCount: 9 } },
        { type: 'MEMORY_STATS', data: { memoryCount: 3 } },
      ],
    });
    const result = await runLoad();
    expect(result).toMatchObject({
      placements: [
        { type: 'agent-stats', span: 6 },
        { type: 'memory-stats', span: 3 },
      ],
      widgetData: {
        'agent-stats': { agentCount: 9 },
        'memory-stats': { memoryCount: 3 },
      },
    });
  });

  it('#647: overrides a placed AGENT_STATS widget count with the owner-scoped total', async () => {
    // The server's dashboardWidgetData still carries a BROAD agent count (e.g.
    // system-wide for a platform admin); the top-level agents(filter:{ownedByMe})
    // total is the caller's OWN count. The loader must prefer the scoped total
    // even when the widget is placed — otherwise an admin sees the broad count.
    mockRequest.mockResolvedValue({
      memories: { items: [], total: 3 },
      agents: { total: 4 },
      dashboardWidgets: [{ type: 'AGENT_STATS', span: 6, position: 0 }],
      dashboardWidgetData: [{ type: 'AGENT_STATS', data: { agentCount: 999 } }],
    });
    const result = (await runLoad()) as { widgetData: { 'agent-stats': { agentCount: number } } };
    expect(result.widgetData['agent-stats']).toEqual({ agentCount: 4 });
  });

  it('orders placements by the server `position`, not array order', async () => {
    mockRequest.mockResolvedValue({
      memories: { items: [], total: 0 },
      agents: { total: 0 },
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
      agents: { total: 0 },
      dashboardWidgets: [{ type: 'NOT_A_REAL_WIDGET', span: 4, position: 0 }],
      dashboardWidgetData: [],
    });
    const result = (await runLoad()) as { placements: Array<{ type: string }> };
    expect(result.placements).toEqual([
      { type: 'memory-stats', span: 4 },
      { type: 'agent-stats', span: 4 },
    ]);
  });

  it('handles an empty workspace', async () => {
    mockRequest.mockResolvedValue({
      memories: { items: [], total: 0 },
      agents: { total: 0 },
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
