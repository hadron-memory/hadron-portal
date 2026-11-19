/**
 * portal#2085 — the `list` action must surface a genuinely published Agent's revisions.
 *
 * Revision nodes are `nodeType: 'system'`. An UNQUALIFIED findNodes hides that node type even when
 * `memoryIds` names the agent's system memory (hrn:node:hadronmemory.com:specs:cor:api:090:02: the
 * memory-class default and the node-type exclusion are orthogonal; naming a nodeType wins). The mock
 * below SIMULATES that server default (it does not run the real server), so a query that omits `nodeType` sees an empty list, as QA did.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORGANIZATIONS_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: (q: string, v?: unknown) => mockRequest(q, v) }),
}));

const REVISION = {
  id: 'rev-node-1',
  loc: 'revisions:rev-1',
  name: 'rev-1',
  description: 'first',
  nodeType: 'system',
  data: { revision: 1, published: true, publishedAt: '2026-11-14T00:00:00.000Z', versionLabel: 'v1' },
};

const UNQUALIFIED_EXCLUDED = ['system', 'chat-message'];

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockImplementation(async (query: string, vars?: Record<string, unknown>) => {
    if (query === ORGANIZATIONS_QUERY) {
      return {
        organizations: {
          items: [{ id: 'org-a', name: 'A', urn: 'u', agents: [{ id: 'agent-aaa', organizationId: 'org-a', systemMemoryId: 'sys-mem-a' }] }],
          total: 1,
        },
      };
    }
    if (query.includes('findNodes')) {
      if (vars?.offset) return { findNodes: { hits: [] } };
      const qualified = vars?.nodeType as string | undefined;
      const visible = qualified ? [REVISION].filter((n) => n.nodeType === qualified) : [REVISION].filter((n) => !UNQUALIFIED_EXCLUDED.includes(n.nodeType));
      return { findNodes: { hits: visible.map((node) => ({ node })) } };
    }
    throw new Error(`unexpected query: ${query.slice(0, 60)}`);
  });
});

function post(body: unknown) {
  const url = new URL('http://test/api/agent-chat/revisions');
  return {
    url,
    request: new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    locals: { token: 'test-token', user: { id: 'u1' } },
  } as unknown as Parameters<Awaited<typeof import('./+server')>['POST']>[0];
}

describe('POST /api/agent-chat/revisions action=list (portal#2085)', () => {
  it('lists a published system-type revision through the simulated findNodes default', async () => {
    const { POST } = await import('./+server');
    const res = await POST(post({ action: 'list', agentId: 'agent-aaa' }));
    const json = (await res.json()) as { revisions: Array<{ loc: string; published: boolean }> };
    expect(res.status).toBe(200);
    expect(json.revisions).toHaveLength(1);
    expect(json.revisions[0]).toMatchObject({ loc: 'revisions:rev-1', published: true });
  });

  it('names the system node type and the revisions prefix in the filter', async () => {
    const { POST } = await import('./+server');
    await POST(post({ action: 'list', agentId: 'agent-aaa' }));
    const call = mockRequest.mock.calls.find(([q]) => String(q).includes('findNodes'));
    // The filter must BIND the variable, not merely declare it: the mock selects on `vars.nodeType`, so
    // a query that declares `$nodeType` but drops it from the filter would still see the revision here.
    expect(call?.[0]).toMatch(/filter:\s*\{[^}]*\bnodeType:\s*\$nodeType\b/);
    expect(call?.[1]).toMatchObject({ memoryIds: ['sys-mem-a'], nodeType: 'system' });
  });
});
