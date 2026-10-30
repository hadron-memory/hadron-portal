/**
 * portal#1429 (S2a of #1380): the memory layout's payload at the Slice 1 scale.
 *
 * Runs the REAL `/app/memories/[id]/+layout.server` load against the 32,920-node
 * synthetic memory the profile uses and pins what SvelteKit would inline into
 * the page HTML: the three keys no route reads are gone, and the whole payload
 * stays under a byte bound. The bound is set between the slimmed payload
 * (graphNodes + a few scalars) and the pre-S2a one (that plus the three
 * projections), so putting any of them back fails here.
 */
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MEMORY_BY_ID_QUERY,
  SELF_CAN_WRITE_QUERY,
  MEMORY_NODES_QUERY,
  MEMORY_EDGES_QUERY,
  MEMORY_LAYOUT_ORG_QUERY,
} from '$lib/server/queries';
import { synthMemory } from './synth-memory';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

const requireFromKit = createRequire(join(realpathSync(resolve(process.cwd(), 'node_modules/@sveltejs/kit')), 'package.json'));
const devalue = requireFromKit('devalue') as { uneval: (v: unknown) => string };

const SERVER_PAGE = 2000;
const MIB = 1048576;
// Slimmed payload measures ~24.0 MiB at this fixture; the pre-S2a one 47.55.
const BOUND_MIB = 26;

beforeEach(() => {
  mockRequest.mockReset();
});

describe('memory layout payload at 32,920 nodes (portal#1429)', () => {
  it('omits treeEntries, graphViewData and usageByNode and stays under the byte bound', async () => {
    const world = synthMemory(32920);
    mockRequest.mockImplementation(async (query: string, vars: Record<string, unknown>) => {
      const limit = Math.min(Number(vars?.limit ?? 1000), SERVER_PAGE);
      const offset = Number(vars?.offset ?? 0);
      if (query === MEMORY_BY_ID_QUERY) return { memory: world.memory };
      if (query === SELF_CAN_WRITE_QUERY) return { effectiveAccess: { canWrite: true } };
      if (query === MEMORY_LAYOUT_ORG_QUERY) return { organization: { id: 'org-1', name: 'Org', urn: 'hrn:org:example.test', members: [] } };
      if (query === MEMORY_NODES_QUERY) {
        return { memoryNodes: { nodes: world.nodes.slice(offset, offset + limit), total: world.nodes.length } };
      }
      if (query === MEMORY_EDGES_QUERY) {
        return { memoryEdges: { edges: world.edges.slice(offset, offset + limit), total: world.edges.length } };
      }
      throw new Error(`unexpected query: ${String(query).slice(0, 60)}`);
    });
    const { load } = await import('../src/routes/app/memories/[id]/+layout.server');
    const data = (await load({ params: { id: world.memory.id }, locals: { token: 't', user: { id: 'u' } } } as never)) as Record<string, unknown>;

    expect(Object.keys(data).sort()).toEqual(['canWriteMemory', 'graph', 'graphNodes', 'nodesFailed', 'nodesTotal', 'org']);
    expect((data.graphNodes as unknown[]).length).toBe(32920);
    const bytes = devalue.uneval(data).length;
    expect(bytes).toBeLessThan(BOUND_MIB * MIB);
  }, 120_000);
});
