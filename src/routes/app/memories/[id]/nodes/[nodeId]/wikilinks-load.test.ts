/**
 * #374 — the node-detail loader hands the page a `[[loc]]` resolution map.
 *
 * The unit-level rules live in `$lib/server/wikilinks`; what's asserted here is
 * the wiring: BOTH markdown surfaces on this page (content and abstract) are
 * scanned, and a bare loc is scoped to this memory's `graphNodes` — the same
 * memory-scoped table the breadcrumb uses (#234), so no GraphQL round-trip and
 * no cross-memory bleed.
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

const MEM = 'mem-A';

type Wikilinks = Record<string, { href: string; label: string } | null>;

async function runLoad(opts: {
  content?: string | null;
  abstract?: string | null;
  graphNodes: Array<{ id: string; memoryId: string; loc: string; name?: string }>;
  memoryUrn?: string;
}) {
  mockRequest.mockResolvedValueOnce({
    node: {
      id: 'leaf-pk', memoryId: MEM, loc: 'notes:leaf', name: 'leaf',
      nodeType: 'info', alias: null, description: null,
      content: opts.content ?? null, abstract: opts.abstract ?? null,
      tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
      isRunnable: null, createdAt: '', updatedAt: '',
      outgoingEdges: [], incomingEdges: [],
    },
  });
  // The streamed Move-picker list; anything after it is unused by these cases.
  mockRequest.mockResolvedValue({ memories: { items: [], total: 0 } });

  const { load } = await import('./+page.server');
  const event = {
    params: { id: MEM, nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL(`http://localhost/app/memories/${MEM}/nodes/leaf-pk`),
    parent: vi.fn().mockResolvedValue({
      graphNodes: opts.graphNodes,
      graph: { id: MEM, urn: opts.memoryUrn ?? 'hrn:memory:hadronmemory.com::hadron-portal' },
      isConsumerMode: false,
      activeOrgId: 'org-1',
    }),
  } as unknown as Parameters<typeof load>[0];

  return (await load(event)) as unknown as { wikilinks: Wikilinks };
}

describe('node-detail load — wikilink resolution (#374)', () => {
  it('resolves a bare loc from this memory, with the target node name as the label', async () => {
    const result = await runLoad({
      content: 'Background: [[findings:x]].',
      graphNodes: [
        { id: 'leaf-pk', memoryId: MEM, loc: 'notes:leaf' },
        { id: 'x-pk', memoryId: MEM, loc: 'findings:x', name: 'Finding X' },
      ],
    });

    expect(result.wikilinks['findings:x']).toEqual({
      href: `/app/memories/${MEM}/nodes/x-pk`,
      label: 'Finding X',
    });
  });

  it('scans the abstract too, not just the body', async () => {
    const result = await runLoad({
      content: null,
      abstract: 'See [[findings:x]].',
      graphNodes: [{ id: 'x-pk', memoryId: MEM, loc: 'findings:x', name: 'Finding X' }],
    });

    expect(result.wikilinks['findings:x']?.href).toBe(`/app/memories/${MEM}/nodes/x-pk`);
  });

  it('does not borrow a same-loc node from another memory for a bare wikilink', async () => {
    const result = await runLoad({
      content: '[[findings:x]]',
      graphNodes: [
        { id: 'leaf-pk', memoryId: MEM, loc: 'notes:leaf' },
        { id: 'foreign-pk', memoryId: 'mem-B', loc: 'findings:x', name: 'Foreign X' },
      ],
    });

    // Memory A has no `findings:x` — the reader must see the gap, not memory
    // B's node. Same footgun as the #234 breadcrumb / hadron-server#335.
    expect(result.wikilinks['findings:x']).toBeNull();
  });

  it('resolves same-memory wikilinks without any extra GraphQL request', async () => {
    await runLoad({
      content: '[[findings:x]] [[findings:y]]',
      graphNodes: [
        { id: 'x-pk', memoryId: MEM, loc: 'findings:x', name: 'X' },
        { id: 'y-pk', memoryId: MEM, loc: 'findings:y', name: 'Y' },
      ],
    });

    const docs = mockRequest.mock.calls.map(([doc]) => String(doc));
    expect(docs.some((d) => d.includes('WikilinkTargets'))).toBe(false);
  });

  it('returns an empty map for a node whose body has no wikilinks', async () => {
    const result = await runLoad({ content: 'Plain prose.', graphNodes: [] });
    expect(result.wikilinks).toEqual({});
  });
});
