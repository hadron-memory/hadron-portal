/**
 * #806: preset create/delete shims over the owner-gated server mutations.
 * Validation happens here (type allowlist, trimmed non-empty name, plain-object
 * config); server errors (duplicate name, foreign presetRef) surface as 400s
 * with the extracted message for inline display.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CREATE_DASHBOARD_WIDGET_PRESET_MUTATION,
  DELETE_DASHBOARD_WIDGET_PRESET_MUTATION,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importMod() {
  return import('./+server');
}

function ev(method: string, body: unknown) {
  return {
    request: new Request('http://localhost/app/dashboard/widget-presets', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    locals: { token: 't' },
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['POST']>[0];
}

async function runPost(body: unknown) {
  const { POST } = await importMod();
  const res = await POST(ev('POST', body));
  return { status: res.status, body: await res.json() };
}

async function runDelete(body: unknown) {
  const { DELETE } = await importMod();
  const res = await DELETE(ev('DELETE', body));
  return { status: res.status, body: await res.json() };
}

describe('POST /app/dashboard/widget-presets (#806)', () => {
  it('creates a preset, mapping the portal type to the server enum and back', async () => {
    mockRequest.mockResolvedValueOnce({
      createDashboardWidgetPreset: {
        id: 'p1',
        type: 'USAGE_ACTIVITY',
        name: 'Team 30d',
        config: { windowDays: 30 },
      },
    });
    const { status, body } = await runPost({
      type: 'usage-activity',
      name: '  Team 30d  ',
      config: { windowDays: 30 },
    });
    expect(status).toBe(200);
    expect(body.preset).toEqual({
      id: 'p1',
      type: 'usage-activity',
      name: 'Team 30d',
      config: { windowDays: 30 },
    });
    expect(mockRequest).toHaveBeenCalledWith(CREATE_DASHBOARD_WIDGET_PRESET_MUTATION, {
      type: 'USAGE_ACTIVITY',
      name: 'Team 30d',
      config: { windowDays: 30 },
    });
  });

  it.each([
    ['unknown type', { type: 'bogus', name: 'x', config: {} }],
    ['blank name', { type: 'usage-activity', name: '   ', config: {} }],
    ['array config', { type: 'usage-activity', name: 'x', config: [] }],
    ['missing config', { type: 'usage-activity', name: 'x' }],
  ])('rejects %s with 400 before calling the API', async (_label, body) => {
    const { status } = await runPost(body);
    expect(status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  // #835/#846 (@copilot) — the same rejection, at the request boundary, for the
  // keys `WIDGET_TYPE_TO_SERVER` inherits. This is the strongest place in the
  // sweep to pin the class: `type` here is a field of a JSON body the caller
  // writes, so it is attacker-typed in the plainest possible sense.
  //
  // Before the guard, `WIDGET_TYPE_TO_SERVER['constructor']` was the truthy
  // Object constructor, so `serverType` passed the `!serverType` check and the
  // handler went on to CALL the API with it. Asserting both halves — the 400
  // AND that no request was issued — because the second is what "validated
  // before we talk to the server" actually means, and a 400 alone would still
  // pass if the mutation had been attempted and failed.
  it.each(Object.getOwnPropertyNames(Object.prototype))(
    'rejects the inherited type key %s with 400 before calling the API',
    async (type) => {
      const { status } = await runPost({ type, name: 'x', config: {} });
      expect(status).toBe(400);
      expect(mockRequest).not.toHaveBeenCalled();
    },
  );

  it('surfaces a duplicate-name server error as a 400 with the message', async () => {
    mockRequest.mockRejectedValueOnce(new Error('A preset with that name already exists.'));
    const { status, body } = await runPost({
      type: 'usage-activity',
      name: 'Team 30d',
      config: {},
    });
    expect(status).toBe(400);
    expect(body.error).toContain('already exists');
  });
});

describe('DELETE /app/dashboard/widget-presets (#806)', () => {
  it('deletes by presetRef', async () => {
    mockRequest.mockResolvedValueOnce({ deleteDashboardWidgetPreset: true });
    const { status, body } = await runDelete({ presetRef: 'p1' });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mockRequest).toHaveBeenCalledWith(DELETE_DASHBOARD_WIDGET_PRESET_MUTATION, {
      presetRef: 'p1',
    });
  });

  it('rejects a missing presetRef with 400 before calling the API', async () => {
    const { status } = await runDelete({});
    expect(status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
