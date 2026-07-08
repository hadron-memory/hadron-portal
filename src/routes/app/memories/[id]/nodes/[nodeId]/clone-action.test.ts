/**
 * duplicate action (#501 / hadron-server#564): cloneNode into <loc>-copy,
 * stepping the suffix on NODE_ALREADY_EXISTS (clones never overwrite),
 * surfacing other errors, and redirecting to the new node.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_BY_ID_QUERY, CLONE_NODE_MUTATION } from '$lib/server/queries';

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
  loc: 'classify',
  name: 'Classify',
  tags: [],
  memory: { id: 'mem-1', urn: 'acme.com::flows', name: 'Flows' },
};

/** The GraphQL-error shape extractGqlErrorCode reads. */
const conflictError = () => ({
  response: {
    errors: [
      {
        message: 'A live node already occupies loc "x" in the destination memory.',
        extensions: { code: 'NODE_ALREADY_EXISTS' },
      },
    ],
  },
});

async function runDuplicate() {
  const { actions } = await import('./+page.server');
  return actions.duplicate({
    params: { id: 'mem-1', nodeId: 'pk' },
    locals: { token: 'tok' },
  } as never);
}

function cloneCalls() {
  return mockRequest.mock.calls.filter(([q]) => q === CLONE_NODE_MUTATION);
}

describe('duplicate action (#501)', () => {
  it('clones to <loc>-copy and redirects to the new node', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === CLONE_NODE_MUTATION) return { cloneNode: { id: 'new-pk', memoryId: 'mem-1' } };
      throw new Error('unexpected query');
    });
    await expect(runDuplicate()).rejects.toMatchObject({
      status: 303,
      location: '/app/memories/mem-1/nodes/new-pk',
    });
    expect(cloneCalls()[0][1]).toMatchObject({
      sourceRef: 'pk',
      targetUrn: 'hrn:node:acme.com::flows::classify-copy',
    });
  });

  it('steps the suffix when the -copy slot is occupied', async () => {
    let attempt = 0;
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === CLONE_NODE_MUTATION) {
        attempt++;
        if (attempt < 3) throw conflictError();
        return { cloneNode: { id: 'new-pk', memoryId: 'mem-1' } };
      }
      throw new Error('unexpected query');
    });
    await expect(runDuplicate()).rejects.toMatchObject({ status: 303 });
    expect(cloneCalls().map(([, vars]) => (vars as { targetUrn: string }).targetUrn)).toEqual([
      'hrn:node:acme.com::flows::classify-copy',
      'hrn:node:acme.com::flows::classify-copy-2',
      'hrn:node:acme.com::flows::classify-copy-3',
    ]);
  });

  it('gives up with a 409 after five occupied slots', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === CLONE_NODE_MUTATION) throw conflictError();
      throw new Error('unexpected query');
    });
    const result = (await runDuplicate()) as { status: number; data: { error: string } };
    expect(result.status).toBe(409);
    expect(cloneCalls()).toHaveLength(5);
  });

  it('surfaces non-conflict errors immediately (no retry)', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === CLONE_NODE_MUTATION) {
        throw { response: { errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] } };
      }
      throw new Error('unexpected query');
    });
    const result = (await runDuplicate()) as { status: number; data: { error: string } };
    expect(result.status).toBe(500);
    expect(result.data.error).toBe('Forbidden');
    expect(cloneCalls()).toHaveLength(1);
  });
});
