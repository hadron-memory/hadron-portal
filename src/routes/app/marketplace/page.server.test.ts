import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

/**
 * Route both documents off their CONTENT rather than off call order.
 *
 * The loader fires the catalogue read and the owned-agents read through one
 * `Promise.allSettled`, so an order-based mock (`mockResolvedValueOnce` twice)
 * silently encodes which of the two is issued first. That is an implementation
 * detail of the loader, not a contract — and the failure mode when it changes
 * is a test that hands the agents response to the catalogue query and still
 * passes on some assertions.
 */
function routeQueries(opts: {
  catalogue?: unknown;
  catalogueError?: Error;
  agents?: Array<{ id: string; name: string; urn: string }>;
  agentsError?: Error;
} = {}) {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc.includes('marketplaceOrganizations')) {
      if (opts.catalogueError) throw opts.catalogueError;
      return (
        opts.catalogue ?? {
          marketplaceOrganizations: { items: [], total: 0 },
          marketplaceAgents: { items: [], total: 0 },
          marketplaceMemories: { items: [], total: 0 },
        }
      );
    }
    if (doc.includes('ownedByMe')) {
      if (opts.agentsError) throw opts.agentsError;
      const items = opts.agents ?? [];
      return { agents: { items, total: items.length } };
    }
    throw new Error(`unexpected document in test: ${doc.slice(0, 80)}`);
  });
}

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  routeQueries();
});

async function runLoad(token: string | null = 'test-token') {
  const mod = await import('./+page.server');
  return mod.load({ locals: { token, user: { id: 'user-1' } } } as any) as any;
}

// The `addToMyMemories` action this file also used to cover was removed in
// #681 — hadron-server#771 retired the mutation with spec 048's personal orgs,
// so the action had been failing at runtime. Its tests went with it; they had
// been passing against a mock the whole time. #685 gives the page an action
// again, against a DIFFERENT mutation — see the `addToAgent` block below.
describe('marketplace load — the three catalogue sections (#610 Phase 4b)', () => {
  it('returns organizations / agents / memories sections from MARKETPLACE_QUERY', async () => {
    routeQueries({
      catalogue: {
        marketplaceOrganizations: { items: [{ id: 'o1', name: 'Org', urn: 'org', description: null }], total: 1 },
        marketplaceAgents: { items: [], total: 0 },
        marketplaceMemories: { items: [{ id: 'm1', name: 'Mem', urn: 'mem', description: 'd' }], total: 3 },
      },
    });
    const res = await runLoad();
    expect(res.organizations.items[0].id).toBe('o1');
    expect(res.agents.items).toEqual([]);
    expect(res.memories.total).toBe(3);
  });

  // #687 — the point is that these two states are DISTINGUISHABLE. Every
  // section is EMPTY on failure, so `!anyResults` is true either way and the
  // page would assert "The marketplace is empty for now." about a catalogue it
  // could not read. The old assertion below passed in both states, which is how
  // the bug survived.
  it('degrades to empty sections when the query fails, and SAYS it failed', async () => {
    routeQueries({ catalogueError: new Error('boom') });
    const res = await runLoad();
    expect(res.organizations).toEqual({ items: [], total: 0 });
    expect(res.agents).toEqual({ items: [], total: 0 });
    expect(res.memories).toEqual({ items: [], total: 0 });
    expect(res.loadFailed).toBe(true);
  });

  it('reports loadFailed false on a genuinely empty catalogue', async () => {
    const res = await runLoad();
    expect(res.organizations).toEqual({ items: [], total: 0 });
    expect(res.loadFailed).toBe(false);
  });
});

/**
 * #685 — the adopt picker's options.
 *
 * The two reads are independent on purpose, and the pair of tests below is what
 * makes that a fact rather than a comment: each failure has to leave the OTHER
 * half intact. A single try/catch around both would pass the first of them and
 * fail the second.
 */
describe('marketplace load — adopt targets (#685)', () => {
  it('offers the caller’s own agents, as {id,name,urn}', async () => {
    routeQueries({
      agents: [{ id: 'a1', name: 'Scribe', urn: 'hrn:agent:acme.test:scribe' }],
    });
    const res = await runLoad();
    expect(res.adoptTargets).toEqual([{ id: 'a1', name: 'Scribe', urn: 'hrn:agent:acme.test:scribe' }]);
    expect(res.adoptTargetsFailed).toBe(false);
  });

  it('an agents-query failure is reported, and does NOT blank the catalogue', async () => {
    routeQueries({
      catalogue: {
        marketplaceOrganizations: { items: [], total: 0 },
        marketplaceAgents: { items: [], total: 0 },
        marketplaceMemories: { items: [{ id: 'm1', name: 'Mem', urn: 'mem', description: null }], total: 1 },
      },
      agentsError: new Error('agents boom'),
    });
    const res = await runLoad();
    expect(res.adoptTargets).toEqual([]);
    expect(res.adoptTargetsFailed).toBe(true);
    // The half that did load is still there — this is the assertion a shared
    // try/catch breaks.
    expect(res.memories.items).toHaveLength(1);
    expect(res.loadFailed).toBe(false);
  });

  it('a catalogue failure does NOT blank the adopt targets', async () => {
    routeQueries({
      catalogueError: new Error('catalogue boom'),
      agents: [{ id: 'a1', name: 'Scribe', urn: 'hrn:agent:acme.test:scribe' }],
    });
    const res = await runLoad();
    expect(res.loadFailed).toBe(true);
    expect(res.adoptTargetsFailed).toBe(false);
    expect(res.adoptTargets).toHaveLength(1);
  });

  it('an empty agent list is NOT reported as a failure', async () => {
    const res = await runLoad();
    expect(res.adoptTargets).toEqual([]);
    expect(res.adoptTargetsFailed).toBe(false);
  });
});

describe('marketplace addToAgent action (#685)', () => {
  async function runAction(fields: Record<string, string>) {
    const mod = await import('./+page.server');
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.append(k, v);
    return (mod.actions as any).addToAgent({
      request: new Request('http://localhost/app/marketplace?/addToAgent', { method: 'POST', body }),
      locals: { token: 'test-token', user: { id: 'user-1' } },
    } as any);
  }

  function addToAgentCalls() {
    return mockRequest.mock.calls.filter(([doc]) => String(doc).includes('addMemoryToAgent'));
  }

  it('attaches the memory to the chosen agent as read-only', async () => {
    mockRequest.mockResolvedValue({ addMemoryToAgent: { id: 'a1' } });
    const res: any = await runAction({ _kind: 'addToAgent', memoryId: 'm1', agentId: 'a1' });

    expect(addToAgentCalls()).toHaveLength(1);
    // The role is SENT, not left to the resolver's `role ?? 'read'` default.
    expect(addToAgentCalls()[0][1]).toEqual({ agentRef: 'a1', memoryRef: 'm1', role: 'read' });
    expect(res.form.message).toEqual({ type: 'success', text: 'Added to your agent.' });
  });

  // The counterpart to the success case: the wiring has to be provable in the
  // failing direction too, or "it called the mutation" is the only thing under
  // test (hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail).
  it('refuses a submission with no agent chosen, and calls nothing', async () => {
    const res: any = await runAction({ _kind: 'addToAgent', memoryId: 'm1', agentId: '' });
    expect(res.status).toBe(400);
    expect(res.data.form.valid).toBe(false);
    expect(addToAgentCalls()).toHaveLength(0);
  });

  it('refuses a submission with no memory, and calls nothing', async () => {
    const res: any = await runAction({ _kind: 'addToAgent', memoryId: '', agentId: 'a1' });
    expect(res.status).toBe(400);
    expect(addToAgentCalls()).toHaveLength(0);
  });

  it('surfaces a server refusal as an error message rather than throwing', async () => {
    mockRequest.mockRejectedValue(new Error('A private-class memory cannot be attached'));
    const res: any = await runAction({ _kind: 'addToAgent', memoryId: 'm1', agentId: 'a1' });
    expect(res.status).toBe(500);
    expect(res.data.form.message.type).toBe('error');
    expect(res.data.form.message.text).toContain('private-class memory');
  });

  // The action is discriminated by `_kind`; a payload aimed at a different form
  // must not be accepted by this one.
  it('rejects a payload carrying another form’s discriminator', async () => {
    const res: any = await runAction({ _kind: 'addMemory', memoryId: 'm1', agentId: 'a1' });
    expect(res.status).toBe(400);
    expect(addToAgentCalls()).toHaveLength(0);
  });
});
