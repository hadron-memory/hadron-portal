/**
 * delete action (#621): deleting a parent node. The server refuses a
 * non-recursive deleteNode with NODE_HAS_DESCENDANTS (it names the count and
 * points at recursive: true) — the portal must turn that refusal into an
 * actionable message plus the count on the action result, and forward the
 * user's explicit "delete the whole subtree" choice as recursive.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE_NODE_MUTATION, NODE_BY_ID_QUERY } from '$lib/server/queries';

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
  loc: 'findings',
  name: 'Findings',
  memory: { id: 'mem-1', urn: 'acme.com::kb', name: 'KB' },
};

// The server's typed refusal (hadron-server resolvers.mutation.node.ts):
// NODE_HAS_DESCENDANTS with the descendant count in extensions.
function descendantRefusal(count: number): Error {
  return {
    name: 'ClientError',
    message: 'refused',
    response: {
      errors: [{
        message: `Node "pk" has ${count} descendant(s). Pass recursive: true to delete the whole subtree.`,
        extensions: { code: 'NODE_HAS_DESCENDANTS', count, ref: 'pk' },
      }],
    },
  } as never;
}

async function runDelete(fields: Record<string, string> = {}) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  fd.set('_kind', 'deleteNode');
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return actions.delete({
    request: { formData: async () => fd },
    params: { id: 'mem-1', nodeId: 'pk' },
    locals: { token: 'tok' },
  } as never);
}

function deleteVars() {
  return mockRequest.mock.calls.find(([q]) => q === DELETE_NODE_MUTATION)?.[1] as
    | { nodeRef: string; hard: boolean; recursive: boolean }
    | undefined;
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { message?: unknown } };
    form?: { message?: unknown };
  } | undefined)?.data?.form ?? (result as { form?: { message?: unknown } } | undefined)?.form;
}

describe('delete action (#621)', () => {
  it('soft-deletes a leaf and redirects to the memory\'s node list', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === DELETE_NODE_MUTATION) return { deleteNode: true };
      throw new Error('unexpected query');
    });
    await expect(runDelete()).rejects.toMatchObject({
      status: 303,
      location: '/app/memories/mem-1/nodes',
    });
    expect(deleteVars()).toEqual({ nodeRef: 'pk', hard: false, recursive: false });
  });

  it('forwards hard and recursive from the confirm dialog', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === DELETE_NODE_MUTATION) return { deleteNode: true };
      throw new Error('unexpected query');
    });
    await expect(runDelete({ hard: 'true', recursive: 'true' })).rejects.toMatchObject({ status: 303 });
    expect(deleteVars()).toEqual({ nodeRef: 'pk', hard: true, recursive: true });
  });

  it('maps NODE_HAS_DESCENDANTS to a 409 with an actionable message and the count', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === DELETE_NODE_MUTATION) throw descendantRefusal(3);
      throw new Error('unexpected query');
    });
    const result = (await runDelete()) as unknown as {
      status: number;
      data: { deleteRefusedDescendants?: number };
    };
    expect(result.status).toBe(409);
    // The message must be actionable (#621: "recursive" alone is not): it
    // names the count and tells the user which checkbox deletes the subtree.
    const text = (superFormFrom(result)?.message as { text: string }).text;
    expect(text).toContain('3 descendant');
    expect(text).toContain('Also delete');
    // The count rides the action result so the dialog can render the
    // subtree checkbox even when the page's graph payload undercounted.
    expect(result.data.deleteRefusedDescendants).toBe(3);
  });

  it('keeps other server errors as 500s with the server text, no refusal key', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === DELETE_NODE_MUTATION) {
        return Promise.reject({
          name: 'ClientError',
          response: { errors: [{ message: 'Memory is syncing', extensions: { code: 'MEMORY_SYNCING' } }] },
        });
      }
      throw new Error('unexpected query');
    });
    const result = (await runDelete()) as unknown as {
      status: number;
      data?: { deleteRefusedDescendants?: number };
    };
    expect(result.status).toBe(500);
    expect((superFormFrom(result)?.message as { text: string }).text).toContain('Memory is syncing');
    expect(result.data?.deleteRefusedDescendants).toBeUndefined();
  });
});
