/**
 * #1161 — the node-detail loader marks an edge whose far endpoint the SERVER
 * reports deleted (recoveryEdges), and only when an endpoint is missing at all.
 * A missing endpoint with no matching report stays masked (unreadable memory).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RECOVERY_EDGES_QUERY } from '$lib/server/queries';
import { serveMemoryReads } from '$lib/test/serveMemoryReads';

// portal#1433: the node reads that replaced the layout's graphNodes.
let reads = serveMemoryReads([], { id: 'mem-1', urn: 'hrn:mem:acme.com:notes' });
const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  mockRequest.mockReset();
});

const MEM = 'mem-A';
const live = { id: 'live-pk', name: 'Live', loc: 'live', memory: { id: MEM, urn: 'hrn:mem:acme.com:notes' } };

async function runLoad(incomingEdges: unknown[], recoveryItems: unknown[] = []) {
  mockRequest.mockImplementation(async (q: string, vars?: Record<string, unknown>) => {
    { const served = reads(q, vars); if (served !== undefined) return served; }
    if (q === RECOVERY_EDGES_QUERY) return { recoveryEdges: { items: recoveryItems, total: recoveryItems.length } };
    if (String(q).includes('query NodeById')) {
      return {
        node: {
          id: 'leaf-pk', memoryId: MEM, loc: 'notes:leaf', name: 'leaf', nodeType: 'info', alias: null,
          description: null, content: null, abstract: null, tokens: null, tags: [], seq: null, data: null,
          ownerRepo: null, isRunnable: null, createdAt: '', updatedAt: '', outgoingEdges: [], incomingEdges,
        },
      };
    }
    return { memories: { items: [], total: 0 } };
  });
  const { load } = await import('./+page.server');
  const event = {
    params: { id: MEM, nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL(`http://localhost/app/memories/${MEM}/nodes/leaf-pk`),
    parent: vi.fn().mockResolvedValue({
      graphNodes: [], graph: { id: MEM, urn: 'hrn:mem:acme.com:notes' }, isConsumerMode: false, activeOrgId: 'org-1',
    }),
  } as unknown as Parameters<typeof load>[0];
  return (await load(event)) as unknown as { deletedEdges: Record<string, { source?: { id: string; name: string } }> };
}

describe('node-detail load — deleted edge endpoints (#1161)', () => {
  it('marks the deleted source the server reported for an incoming edge', async () => {
    const data = await runLoad(
      [{ id: 'e1', name: 'related', loc: 'e1', source: null, target: live }],
      [{ id: 'e1', name: 'related', source: { id: 'gone-pk', urn: 'hrn:node:acme.com:notes:gone', loc: 'gone', name: 'Gone', deletedAt: '2026-10-19T10:00:00Z' }, target: { ...live, urn: 'u', deletedAt: null } }],
    );
    expect(data.deletedEdges.e1.source).toMatchObject({ id: 'gone-pk', name: 'Gone' });
  });

  it('does not ask, and marks nothing, when every endpoint is readable', async () => {
    const data = await runLoad([{ id: 'e1', name: 'related', loc: 'e1', source: live, target: live }]);
    expect(mockRequest.mock.calls.some(([q]) => q === RECOVERY_EDGES_QUERY)).toBe(false);
    expect(data.deletedEdges).toEqual({});
  });

  it('leaves a missing endpoint masked when the server does not report it deleted', async () => {
    const data = await runLoad([{ id: 'e2', name: 'related', loc: 'e2', source: null, target: live }], []);
    expect(data.deletedEdges).toEqual({});
  });
});

// The page itself is far too large to mount here; this pins only that the edge
// rows read the loader's server-reported map and badge a deleted endpoint, while
// an unreported missing endpoint still falls back to the masked placeholder.
describe('node page edge rows (#1161, source pin)', () => {
  it('badges a server-reported deleted endpoint and keeps the masked fallback', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('src/routes/app/memories/[id]/nodes/[nodeId]/+page.svelte', 'utf8');
    expect(page).toContain('data.deletedEdges?.[e.id]?.source');
    expect(page).toContain('data.deletedEdges?.[e.id]?.target');
    expect(page).toContain('data-testid="edge-endpoint-deleted"');
    expect(page).toContain('?? PRIVATE_ENDPOINT');
  });
});
