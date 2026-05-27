/**
 * #237 regression — the edit route carries the same URL-acceptance guard
 * as the detail page. Without it, a mismatched `(gid, nodeId)` URL would
 * let the user save changes into a foreign-memory node while believing
 * they edit the current memory's row. Test pins the redirect to the
 * correct edit URL.
 *
 * Strategy mirrors the detail page's page.server.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

async function importLoad() {
  const mod = await import('./+page.server');
  return mod.load;
}

function loadEvent(opts: { gid: string; nodeId: string }) {
  return {
    params: { id: 'org-1', gid: opts.gid, nodeId: opts.nodeId },
    locals: { token: 'tok' },
    parent: vi.fn().mockResolvedValue({
      isConsumerMode: false,
      activeOrgId: 'org-1',
    }),
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

describe('edit-node load — #237 PK-mismatch guard', () => {
  it('redirects to the correct memory`s edit URL when node.memoryId does not match params.gid', async () => {
    mockRequest.mockResolvedValueOnce({
      nodeById: {
        id: 'leaf-pk', memoryId: 'mem-B', loc: 'foo', name: 'foo',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });

    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(loadEvent({ gid: 'mem-A', nodeId: 'leaf-pk' }));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(303);
    expect((thrown as { location: string }).location).toBe('/app/orgs/org-1/memories/mem-B/nodes/leaf-pk/edit');
  });

  it('does NOT redirect when node.memoryId matches params.gid (happy path)', async () => {
    mockRequest.mockResolvedValueOnce({
      nodeById: {
        id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'foo',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });

    const load = await importLoad();
    const result = await load(loadEvent({ gid: 'mem-A', nodeId: 'leaf-pk' }));
    // SvelteKit's PageServerLoad return type widens to `T | void`; the
    // void half is the redirect path. Happy path here returns data.
    expect(result).toBeDefined();
    expect((result as { node: { id: string } }).node.id).toBe('leaf-pk');
  });
});
