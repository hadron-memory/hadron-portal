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

// #260: org-less route — the memory id is `params.id` (the old `gid`).
function loadEvent(opts: { gid: string; nodeId: string }) {
  return {
    params: { id: opts.gid, nodeId: opts.nodeId },
    locals: { token: 'tok' },
    parent: vi.fn().mockResolvedValue({
      isConsumerMode: false,
      activeOrgId: 'org-1',
    }),
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

describe('edit-node load — #237 PK-mismatch guard', () => {
  it("redirects to the correct memory's edit URL when node.memoryId does not match params.gid", async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
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
    expect((thrown as { location: string }).location).toBe('/app/memories/mem-B/nodes/leaf-pk/edit');
  });

  it('does NOT redirect when node.memoryId matches params.gid (happy path)', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
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

/**
 * #237 review follow-up — the `default` action runs BEFORE `load`, so
 * the URL-time guard above doesn't fire on POST. Action must derive
 * memoryId from the fetched node (not from params.gid) so a stale-URL
 * submission commits to the right memory.
 */
import type { Actions } from './$types';

async function importActions() {
  const mod = await import('./+page.server');
  return mod.actions;
}

function actionEvent(opts: {
  gid: string;
  nodeId: string;
  form: Record<string, string>;
}) {
  const formData = new FormData();
  for (const [k, v] of Object.entries(opts.form)) formData.append(k, v);
  return {
    params: { id: opts.gid, nodeId: opts.nodeId },
    locals: { token: 'tok' },
    request: { formData: async () => formData },
  } as unknown as Parameters<Actions[keyof Actions]>[0];
}

describe('edit-node default action — derives memoryId from fetched node (#237)', () => {
  it("update input.memoryId is the node's actual memoryId, not params.gid", async () => {
    // Stale URL says mem-A; the node lives in mem-B. The update must
    // commit into mem-B so the user's edit lands on the right row.
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk', memoryId: 'mem-B', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, content: 'old',
        tokens: null, tags: ['x'], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk' } });

    const actions = await importActions();
    let thrown: unknown;
    try {
      await actions.default(actionEvent({
        gid: 'mem-A',
        nodeId: 'pk',
        form: { name: 'new', content: 'new', abstract: 'a summary' },
      }));
    } catch (e) {
      thrown = e;
    }
    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: { memoryId: string; abstract: unknown } }];
    expect(vars.input.memoryId).toBe('mem-B');
    // #257: the edit form persists the abstract through the same update.
    expect(vars.input.abstract).toBe('a summary');
    // Post-action redirect URL should point at mem-B too.
    expect((thrown as { status: number }).status).toBe(303);
    expect((thrown as { location: string }).location).toBe('/app/memories/mem-B/nodes/pk');
  });

  it('MOVE_NODE_MUTATION targets the node via sourceRef + targetUrn from its OWN memory (#564)', async () => {
    // When the user edits the loc, the move runs first. #564 reshaped the
    // args: sourceRef is the node's PK and targetUrn is composed from the
    // node's own memory urn — the URL's gid never enters the picture.
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk', memoryId: 'mem-B', loc: 'old-loc', name: 'a',
        memory: { id: 'mem-B', urn: 'acme.com::brain', name: 'Brain' },
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ moveNode: { id: 'pk' } });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk' } });

    const actions = await importActions();
    try {
      await actions.default(actionEvent({
        gid: 'mem-A',
        nodeId: 'pk',
        form: { name: 'a', loc: 'new-loc' },
      }));
    } catch { /* redirect at end */ }

    const [, moveVars] = mockRequest.mock.calls[1]! as [unknown, { sourceRef: string; targetUrn: string }];
    expect(moveVars.sourceRef).toBe('pk');
    expect(moveVars.targetUrn).toBe('hrn:node:acme.com::brain::new-loc');
  });
});
