/**
 * move action (#503): the actions-menu Move dialog relocates the node
 * within its memory via moveNode(sourceRef + targetUrn composed from the
 * node's own memory urn), normalizes the target loc, no-ops an unchanged
 * loc, and fails 409 on an occupied destination.
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

async function runMove(loc: string) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  fd.set('loc', loc);
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

describe('move action (#503)', () => {
  it('moves via sourceRef + composed targetUrn, then redirects to the same node', async () => {
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

  it('no-ops when the target loc equals the current loc (no mutation issued)', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      throw new Error('unexpected query');
    });
    const result = await runMove('flows:classify');
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
