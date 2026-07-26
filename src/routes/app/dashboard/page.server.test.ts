/**
 * #629 / #636: /app/dashboard renders a widget grid for EVERY user. The
 * loader issues ONE DASHBOARD_QUERY (count-only totals, no org redirect) and
 * returns the widget placements (from the server selection, or a default) and
 * the per-widget combined data.
 * #788: the in-place editor saves the layout back via the saveLayout action
 * (position = array order, server row ids kept so they survive the save).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SET_DASHBOARD_WIDGETS_MUTATION } from '$lib/server/queries';

// Restore afterAll so a suite-wide spy can't suppress console.error elsewhere.
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
afterAll(() => errorSpy.mockRestore());

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => mockRequest.mockReset());

async function importMod() {
  return import('./+page.server');
}

async function importLoad() {
  return (await importMod()).load;
}

function ev() {
  return { locals: { token: 't' } } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

async function runLoad() {
  const load = await importLoad();
  return load(ev());
}

/** A server widget row in the full #788 shape. */
function serverWidget(
  over: Partial<{ id: string; type: string; span: number; rowSpan: number; position: number; config: Record<string, unknown> | null }>,
) {
  return { id: 'w1', type: 'MEMORY_STATS', span: 4, rowSpan: 1, position: 0, config: null, ...over };
}

describe('/app/dashboard loader (#629 / #636)', () => {
  it('falls back to the default layout (Memory + Agent stats) when the user has no widgets, seeding data from the totals', async () => {
    mockRequest.mockResolvedValue({
      memories: { total: 7 },
      agents: { total: 3 },
      dashboardWidgets: [],
      dashboardWidgetData: [],
    });
    const result = await runLoad();
    expect(result).toMatchObject({
      placements: [
        { id: null, type: 'memory-stats', span: 4, rowSpan: 1 },
        { id: null, type: 'agent-stats', span: 4, rowSpan: 1 },
      ],
      widgetData: {
        'memory-stats': { memoryCount: 7 },
        'agent-stats': { agentCount: 3 },
      },
    });
  });

  it('maps the server widget selection (id/span/rowSpan/config) to placements and fans dashboardWidgetData out by type', async () => {
    mockRequest.mockResolvedValue({
      memories: { total: 3 },
      agents: { total: 9 },
      dashboardWidgets: [
        serverWidget({ id: 'row-a', type: 'AGENT_STATS', span: 6, rowSpan: 2, position: 0, config: { theme: 'x' } }),
        serverWidget({ id: 'row-b', type: 'MEMORY_STATS', span: 3, position: 1 }),
      ],
      dashboardWidgetData: [
        { type: 'AGENT_STATS', data: { agentCount: 9 } },
        { type: 'MEMORY_STATS', data: { memoryCount: 3 } },
      ],
    });
    const result = await runLoad();
    expect(result).toMatchObject({
      placements: [
        { id: 'row-a', type: 'agent-stats', span: 6, rowSpan: 2, config: { theme: 'x' } },
        { id: 'row-b', type: 'memory-stats', span: 3, rowSpan: 1, config: null },
      ],
      widgetData: {
        'agent-stats': { agentCount: 9 },
        'memory-stats': { memoryCount: 3 },
      },
    });
  });

  it('orders placements by the server `position`, not array order', async () => {
    mockRequest.mockResolvedValue({
      memories: { total: 0 },
      agents: { total: 0 },
      // Deliberately out of order: position 1 before position 0.
      dashboardWidgets: [
        serverWidget({ id: 'w1', span: 6, position: 1 }),
        serverWidget({ id: 'w2', span: 3, position: 0 }),
      ],
      dashboardWidgetData: [{ type: 'MEMORY_STATS', data: { memoryCount: 0 } }],
    });
    const result = (await runLoad()) as { placements: Array<{ span: number }> };
    // position 0 (span 3) must come first.
    expect(result.placements.map((p) => p.span)).toEqual([3, 6]);
  });

  it('skips an unknown server widget type defensively (falls back to default when none map)', async () => {
    mockRequest.mockResolvedValue({
      memories: { total: 1 },
      agents: { total: 0 },
      dashboardWidgets: [serverWidget({ type: 'NOT_A_REAL_WIDGET' })],
      dashboardWidgetData: [],
    });
    const result = (await runLoad()) as { placements: Array<{ type: string }> };
    expect(result.placements.map((p) => p.type)).toEqual(['memory-stats', 'agent-stats']);
  });

  it('handles an empty workspace', async () => {
    mockRequest.mockResolvedValue({
      memories: { total: 0 },
      agents: { total: 0 },
      dashboardWidgets: [],
      dashboardWidgetData: [],
    });
    expect(await runLoad()).toMatchObject({ loadFailed: false });
  });

  // The failure path (`loadFailed: true` + count 0 on a rejected query) is the
  // same plain try/catch as /app/memories and is verified in-browser (error
  // banner renders instead of a misleading "0 memories"). A throwing mock trips
  // this repo's vitest error detector even when the loader catches it, so it
  // isn't unit-tested here.
});

function actionEv(widgets?: unknown) {
  const fd = new FormData();
  if (widgets !== undefined) {
    fd.set('widgets', typeof widgets === 'string' ? widgets : JSON.stringify(widgets));
  }
  return {
    request: { formData: async () => fd },
    locals: { token: 't' },
  } as unknown as Parameters<NonNullable<Awaited<ReturnType<typeof importMod>>['actions']['saveLayout']>>[0];
}

async function runSave(widgets?: unknown) {
  const { actions } = await importMod();
  return actions.saveLayout!(actionEv(widgets));
}

const saveVars = () =>
  mockRequest.mock.calls.find((c) => c[0] === SET_DASHBOARD_WIDGETS_MUTATION)?.[1] as
    | { widgets: Array<Record<string, unknown>> }
    | undefined;

describe('/app/dashboard saveLayout action (#788)', () => {
  beforeEach(() => mockRequest.mockResolvedValue({ setDashboardWidgets: [] }));

  it('maps portal ids → server enum in array order, keeping server row ids', async () => {
    const result = await runSave([
      { id: 'row-a', type: 'agent-stats', span: 6, rowSpan: 2, config: { theme: 'x' } },
      { id: null, type: 'memory-stats', span: 12, rowSpan: 1, config: null },
    ]);
    expect(saveVars()?.widgets).toEqual([
      { id: 'row-a', type: 'AGENT_STATS', span: 6, rowSpan: 2, config: { theme: 'x' } },
      { id: null, type: 'MEMORY_STATS', span: 12, rowSpan: 1, config: null },
    ]);
    expect(result).toEqual({ saved: true });
  });

  it('drops unknown widget types', async () => {
    await runSave([
      { id: null, type: 'memory-stats', span: 4, rowSpan: 1 },
      { id: null, type: 'bogus', span: 4, rowSpan: 1 },
    ]);
    expect(saveVars()?.widgets).toEqual([
      { id: null, type: 'MEMORY_STATS', span: 4, rowSpan: 1, config: null },
    ]);
  });

  it('clamps span into 1–12 and rowSpan into 1–4', async () => {
    await runSave([
      { id: null, type: 'memory-stats', span: 99, rowSpan: 0 },
      { id: null, type: 'agent-stats', span: 0, rowSpan: 9 },
    ]);
    expect(saveVars()?.widgets).toEqual([
      { id: null, type: 'MEMORY_STATS', span: 12, rowSpan: 1, config: null },
      { id: null, type: 'AGENT_STATS', span: 1, rowSpan: 4, config: null },
    ]);
  });

  it('forwards only plain-object configs (arrays and scalars become null)', async () => {
    await runSave([
      { id: null, type: 'memory-stats', span: 4, rowSpan: 1, config: ['not', 'a', 'config'] },
      { id: null, type: 'agent-stats', span: 4, rowSpan: 1, config: 'nope' },
    ]);
    expect(saveVars()?.widgets).toEqual([
      { id: null, type: 'MEMORY_STATS', span: 4, rowSpan: 1, config: null },
      { id: null, type: 'AGENT_STATS', span: 4, rowSpan: 1, config: null },
    ]);
  });

  it('treats a non-string id as unsaved (null) rather than forwarding garbage', async () => {
    await runSave([{ id: 42, type: 'memory-stats', span: 4, rowSpan: 1 }]);
    expect(saveVars()?.widgets).toEqual([
      { id: null, type: 'MEMORY_STATS', span: 4, rowSpan: 1, config: null },
    ]);
  });

  it('accepts an empty selection (clears the dashboard back to the default)', async () => {
    const result = await runSave([]);
    expect(saveVars()?.widgets).toEqual([]);
    expect(result).toEqual({ saved: true });
  });

  it('returns 400 on an unparseable payload without calling the API', async () => {
    const result = await runSave('not json{');
    expect((result as { status?: number })?.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns 400 when the widgets field is missing (does NOT clear the layout)', async () => {
    const result = await runSave(undefined);
    expect((result as { status?: number })?.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('surfaces a GraphQL failure as a 500 form error', async () => {
    mockRequest.mockReset();
    mockRequest.mockRejectedValueOnce(new Error('save blew up'));
    const result = await runSave([{ id: null, type: 'memory-stats', span: 4, rowSpan: 1 }]);
    expect(result).toMatchObject({ status: 500, data: { error: 'save blew up' } });
  });
});
