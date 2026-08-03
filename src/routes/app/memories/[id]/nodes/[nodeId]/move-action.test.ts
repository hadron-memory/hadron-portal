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

async function runMove(target: string, extra: Record<string, string> = {}) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  fd.set('target', target);
  for (const [key, value] of Object.entries(extra)) fd.set(key, value);
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

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { data?: Record<string, unknown>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean } };
    form?: { data?: Record<string, unknown>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.data?.form ?? (result as {
    form?: { data?: Record<string, unknown>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.form;
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
    expect(moveVars()).toEqual({ sourceRef: 'pk', targetUrn: 'hrn:node:acme.com:flows:flows:renamed' });
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
    expect(superFormFrom(result)?.message).toEqual({
      type: 'success',
      text: 'Node is already at that destination.',
    });
    expect(moveVars()).toBeUndefined();
  });

  it('no-ops when the target uses the canonical hrn:node prefix', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      throw new Error('unexpected query');
    });

    const result = await runMove('hrn:node:acme.com::flows::flows:classify');

    expect(superFormFrom(result)?.message).toMatchObject({ type: 'success' });
    expect(moveVars()).toBeUndefined();
  });

  // The no-op check must be blind to URN GRAMMAR, not just to the prefix.
  // composeNodeUrn emits v2 (single colon) per cor:urn:010:01, but a URN pasted
  // from an older screen or another tool may still be v1 (`::`). Both spell the
  // same node, so both must no-op — otherwise the user gets a pointless move
  // mutation instead of "already at that destination".
  it.each([
    ['v1 `::` grammar', 'hrn:node:acme.com::flows::flows:classify'],
    ['v2 flat grammar', 'hrn:node:acme.com:flows:flows:classify'],
    ['v2 flat, no prefix', 'acme.com:flows:flows:classify'],
  ])('no-ops when the target is the current node written in %s', async (_label, target) => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      throw new Error('unexpected query');
    });

    const result = await runMove(target);

    expect(superFormFrom(result)?.message).toMatchObject({ type: 'success' });
    expect(moveVars()).toBeUndefined();
  });

  it('returns a typed 404 message when the node cannot be found', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node: null };
      throw new Error('unexpected query');
    });

    const result = (await runMove('flows:renamed')) as { status: number };

    expect(result.status).toBe(404);
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Node not found' });
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
    const result = (await runMove('flows:taken')) as { status: number };
    expect(result.status).toBe(409);
    expect(superFormFrom(result)?.errors?.target?.[0]).toMatch(/already occupies/);
  });

  // #656 (server #781/#784): cross-memory subtree moves can be refused for
  // user-fixable reasons. Those must surface on the field, not as a generic 500.
  it('surfaces a refused cross-memory move (BAD_USER_INPUT) as a 400 field error', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === MOVE_NODE_MUTATION) {
        throw {
          response: {
            errors: [{
              message: 'Cannot move a subtree into an encrypted memory.',
              extensions: { code: 'BAD_USER_INPUT' },
            }],
          },
        };
      }
      throw new Error('unexpected query');
    });
    const result = (await runMove('other.com::mem::flows:x')) as { status: number };
    expect(result.status).toBe(400);
    expect(superFormFrom(result)?.errors?.target?.[0]).toMatch(/encrypted memory/);
  });

  it('surfaces a concurrent-write CONFLICT as a 409 field error', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === MOVE_NODE_MUTATION) {
        throw {
          response: {
            errors: [{
              message: 'The source subtree changed during the move.',
              extensions: { code: 'CONFLICT' },
            }],
          },
        };
      }
      throw new Error('unexpected query');
    });
    const result = (await runMove('other.com::mem::flows:x')) as { status: number };
    expect(result.status).toBe(409);
    expect(superFormFrom(result)?.errors?.target?.[0]).toMatch(/changed during the move/);
  });

  it('still reports an unexpected server fault as a 500 message', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === MOVE_NODE_MUTATION) throw new Error('boom');
      throw new Error('unexpected query');
    });
    const result = (await runMove('flows:x')) as { status: number };
    expect(result.status).toBe(500);
    expect(superFormFrom(result)?.message).toMatchObject({ type: 'error' });
  });

  it('rejects an empty destination before any lookup', async () => {
    const result = (await runMove('   ')) as { status: number };
    expect(result.status).toBe(400);
    expect(superFormFrom(result)?.errors?.target?.[0]).toBe('Enter a destination node URN.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a tampered form discriminator before any lookup', async () => {
    const result = (await runMove('flows:renamed', { _kind: 'deleteNode' })) as { status: number };
    expect(result.status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind?.[0]).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
