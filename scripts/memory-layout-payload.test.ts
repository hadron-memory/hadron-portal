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

const KIB = 1024;
// portal#1524: with the node list off the payload is the memory, the org and a
// few scalars; a 33k-node memory costs it nothing. Was ~24 MiB (graphNodes).
const BOUND_KIB = 64;

beforeEach(() => {
  mockRequest.mockReset();
});

describe('memory layout payload at 32,920 nodes (portal#1429, portal#1524)', () => {
  it('issues no node-list read, carries no graph/tree keys, and stays tiny however big the memory is', async () => {
    const world = synthMemory(32920);
    const seen: string[] = [];
    mockRequest.mockImplementation(async (query: string) => {
      seen.push(query);
      if (query === MEMORY_BY_ID_QUERY) return { memory: world.memory };
      if (query === SELF_CAN_WRITE_QUERY) return { effectiveAccess: { canWrite: true, canManage: true } };
      if (query === MEMORY_LAYOUT_ORG_QUERY) return { organization: { id: 'org-1', name: 'Org', urn: 'hrn:org:example.test', members: [] } };
      throw new Error(`unexpected query: ${String(query).slice(0, 60)}`);
    });
    const { load } = await import('../src/routes/app/memories/[id]/+layout.server');
    const data = (await load({ params: { id: world.memory.id }, locals: { token: 't', user: { id: 'u' } } } as never)) as Record<string, unknown>;

    // Drain: neither memoryNodes nor memoryEdges is ever asked for.
    expect(seen).not.toContain(MEMORY_NODES_QUERY);
    expect(seen).not.toContain(MEMORY_EDGES_QUERY);
    // Payload: no graph, tree or usage key; the distinct "off" state instead.
    expect(Object.keys(data).sort()).toEqual(['canManageMemory', 'canWriteMemory', 'graph', 'nodesFailed', 'nodesOff', 'nodesTotal', 'org', 'orgReadFailed']);
    expect(data.nodesOff).toBe(true);
    expect(data.nodesFailed).toBe(false); // off is not an error: no banner
    expect(data.nodesTotal).toBeNull();
    const bytes = devalue.uneval(data).length;
    expect(bytes).toBeLessThan(BOUND_KIB * KIB);
  }, 120_000);
});
