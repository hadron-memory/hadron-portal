/**
 * #636: the dashboard widget picker — loader + save action.
 *
 * Mock `$lib/server/api`'s gqlClient, import load/actions, call with a
 * hand-rolled event. The save action maps portal widget ids → the server enum,
 * clamps span, and posts the ordered list to setDashboardWidgets.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SET_DASHBOARD_WIDGETS_MUTATION } from '$lib/server/queries';

const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
afterAll(() => errorSpy.mockRestore());

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => mockRequest.mockReset());

async function importMod() {
  return import('./+page.server');
}

function loadEv() {
  return { locals: { token: 't' } } as unknown as Parameters<
    Awaited<ReturnType<typeof importMod>>['load']
  >[0];
}

function actionEv(widgets: unknown) {
  const fd = new FormData();
  fd.set('widgets', typeof widgets === 'string' ? widgets : JSON.stringify(widgets));
  return {
    request: { formData: async () => fd },
    locals: { token: 't' },
  } as unknown as Parameters<NonNullable<Awaited<ReturnType<typeof importMod>>['actions']['default']>>[0];
}

async function runLoad() {
  const { load } = await importMod();
  return load(loadEv());
}

async function runSave(widgets: unknown) {
  const { actions } = await importMod();
  try {
    return await actions.default!(actionEv(widgets));
  } catch (e) {
    return e; // success path throws a SvelteKit redirect
  }
}

const saveVars = () =>
  mockRequest.mock.calls.find((c) => c[0] === SET_DASHBOARD_WIDGETS_MUTATION)?.[1] as
    | { widgets: Array<{ type: string; span?: number }> }
    | undefined;

describe('/app/dashboard/customize loader', () => {
  it('maps the saved selection to portal placements, ordered by position', async () => {
    mockRequest.mockResolvedValue({
      dashboardWidgets: [
        { type: 'AGENT_STATS', span: 6, position: 1 },
        { type: 'MEMORY_STATS', span: 4, position: 0 },
      ],
    });
    expect(await runLoad()).toEqual({
      placements: [
        { type: 'memory-stats', span: 4 },
        { type: 'agent-stats', span: 6 },
      ],
    });
  });

  it('falls back to the default layout when the user has no saved widgets', async () => {
    mockRequest.mockResolvedValue({ dashboardWidgets: [] });
    expect(await runLoad()).toEqual({
      placements: [
        { type: 'memory-stats', span: 4 },
        { type: 'agent-stats', span: 4 },
      ],
    });
  });

  it('collapses duplicate placements of the same type to the first (by position)', async () => {
    // The server model allows duplicates; the picker is one-per-type, so the
    // loader de-dupes to keep such a selection editable (no duplicate keys).
    mockRequest.mockResolvedValue({
      dashboardWidgets: [
        { type: 'MEMORY_STATS', span: 4, position: 0 },
        { type: 'MEMORY_STATS', span: 12, position: 1 },
        { type: 'AGENT_STATS', span: 6, position: 2 },
      ],
    });
    expect(await runLoad()).toEqual({
      placements: [
        { type: 'memory-stats', span: 4 },
        { type: 'agent-stats', span: 6 },
      ],
    });
  });
});

describe('/app/dashboard/customize save action', () => {
  beforeEach(() => mockRequest.mockResolvedValue({ setDashboardWidgets: [] }));

  it('maps portal ids → server enum in array order and redirects to the dashboard', async () => {
    const result = await runSave([
      { type: 'agent-stats', span: 6 },
      { type: 'memory-stats', span: 12 },
    ]);
    expect(saveVars()?.widgets).toEqual([
      { type: 'AGENT_STATS', span: 6 },
      { type: 'MEMORY_STATS', span: 12 },
    ]);
    expect(result).toMatchObject({ status: 303, location: '/app/dashboard' });
  });

  it('drops unknown widget types', async () => {
    await runSave([{ type: 'memory-stats', span: 4 }, { type: 'bogus', span: 4 }]);
    expect(saveVars()?.widgets).toEqual([{ type: 'MEMORY_STATS', span: 4 }]);
  });

  it('clamps span into 1–12', async () => {
    await runSave([
      { type: 'memory-stats', span: 99 },
      { type: 'agent-stats', span: 0 },
    ]);
    expect(saveVars()?.widgets).toEqual([
      { type: 'MEMORY_STATS', span: 12 },
      { type: 'AGENT_STATS', span: 1 },
    ]);
  });

  it('accepts an empty selection (clears the dashboard back to the default)', async () => {
    const result = await runSave([]);
    expect(saveVars()?.widgets).toEqual([]);
    expect(result).toMatchObject({ status: 303, location: '/app/dashboard' });
  });

  it('returns 400 on an unparseable payload without calling the API', async () => {
    const result = await runSave('not json{');
    expect((result as { status?: number })?.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns 400 when the widgets field is missing (does NOT clear the layout)', async () => {
    const { actions } = await importMod();
    const ev = {
      request: { formData: async () => new FormData() }, // no `widgets` field
      locals: { token: 't' },
    } as unknown as Parameters<NonNullable<Awaited<ReturnType<typeof importMod>>['actions']['default']>>[0];
    const result = await actions.default!(ev);
    expect((result as { status?: number })?.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('surfaces a GraphQL failure as a 500 form error', async () => {
    mockRequest.mockReset();
    mockRequest.mockRejectedValueOnce(new Error('save blew up'));
    const result = await runSave([{ type: 'memory-stats', span: 4 }]);
    expect(result).toMatchObject({ status: 500, data: { error: 'save blew up' } });
  });
});
