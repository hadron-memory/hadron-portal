/**
 * move action (#503 / #489): the Move dialog submits a full destination
 * node URN — cross-memory when its memory segment differs. A bare loc is
 * composed into the current memory; an unchanged target no-ops; an occupied
 * destination fails 409.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_BY_ID_QUERY, MOVE_NODE_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

const node = {
  id: 'pk',
  memoryId: 'mem-1',
  loc: 'flows:classify',
  name: 'Classify',
  memory: { id: 'mem-1', urn: 'acme.com::flows', name: 'Flows' },
};

async function runMove(target: string) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  fd.set('target', target);
  return actions.move({
    request: { formData: async () => fd },
    params: { id: 'mem-1', nodeId: 'pk' },
    locals: { token: 'tok' },
  } as never);
}

function moveVars() {
  return mockRequest.mock.calls.find(([q]) => q === MOVE_NODE_MUTATION)?.[1] as
    | { sourceRef: string; targetUrn: string }
    | undefined;
}

describe('move action (#503 / #489)', () => {
  it('composes a bare loc into the current memory and redirects to the node', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === MOVE_NODE_MUTATION) return { moveNode: { id: 'pk' } };
      throw new Error('unexpected query');
    });
    await expect(runMove('flows:renamed')).rejects.toMatchObject({
      status: 303,
      location: '/app/memories/mem-1/nodes/pk',
    });
    expect(moveVars()).toEqual({ sourceRef: 'pk', targetUrn: 'hrn:node:acme.com::flows::flows:renamed' });
  });

  it('passes a full cross-memory URN straight through as targetUrn', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === MOVE_NODE_MUTATION) return { moveNode: { id: 'pk' } };
      throw new Error('unexpected query');
    });
    // Different memory (acme.com::archive) — server resolves it by URN.
    await expect(runMove('acme.com::archive::flows:classify')).rejects.toMatchObject({ status: 303 });
    expect(moveVars()).toEqual({ sourceRef: 'pk', targetUrn: 'acme.com::archive::flows:classify' });
  });

  it('no-ops when the target resolves to the current full URN (no mutation)', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      throw new Error('unexpected query');
    });
    const result = await runMove('acme.com::flows::flows:classify');
    expect(result).toEqual({ moved: true });
    expect(moveVars()).toBeUndefined();
  });

  it('returns 409 when the destination is occupied', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === MOVE_NODE_MUTATION) {
        throw { response: { errors: [{ message: 'A live node already occupies loc "x".', extensions: { code: 'NODE_ALREADY_EXISTS' } }] } };
      }
      throw new Error('unexpected query');
    });
    const result = (await runMove('flows:taken')) as { status: number; data: { moveError: string } };
    expect(result.status).toBe(409);
    expect(result.data.moveError).toMatch(/already occupies/);
  });

  it('rejects an empty destination before any lookup', async () => {
    const result = (await runMove('   ')) as { status: number; data: { moveError: string } };
    expect(result.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
