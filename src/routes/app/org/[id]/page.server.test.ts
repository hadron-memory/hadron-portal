import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, visit } from 'graphql';
import { PUBLIC_ORGANIZATION_AGENTS_QUERY, PUBLIC_ORGANIZATION_MEMORIES_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
const mockToken = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: (token: string) => {
    mockToken(token);
    return { request: (...args: unknown[]) => mockRequest(...args) };
  },
}));

import { load } from './+page.server';

const memoryOrganization = {
  id: 'org-1',
  name: 'Public Org',
  urn: 'hrn:org:public.test',
  listedOnMarketplace: true,
  publicMemoriesPage: {
    items: [{ id: 'mem-1', name: 'Public Docs', urn: 'hrn:mem:public.test:docs', description: 'Read me' }],
    total: 1,
    hasMore: false,
  },
};
const agentOrganization = {
  id: 'org-1',
  name: 'Public Org',
  urn: 'hrn:org:public.test',
  listedOnMarketplace: true,
  publicAgentsPage: {
    items: [{ id: 'agent-1', name: 'Public Helper', urn: 'hrn:agent:public.test:helper', description: null }],
    total: 1,
    hasMore: false,
  },
};
const organization = {
  id: memoryOrganization.id,
  name: memoryOrganization.name,
  urn: memoryOrganization.urn,
  listedOnMarketplace: memoryOrganization.listedOnMarketplace,
  publicMemoriesPage: memoryOrganization.publicMemoriesPage,
  publicAgentsPage: agentOrganization.publicAgentsPage,
};

function succeed() {
  mockRequest.mockImplementation((query: string) => Promise.resolve({
    publicOrganization: query === PUBLIC_ORGANIZATION_MEMORIES_QUERY ? memoryOrganization : agentOrganization,
  }));
}

beforeEach(() => {
  mockRequest.mockReset();
  mockToken.mockReset();
});

function ev(id: string, search = '') {
  return {
    params: { id },
    locals: { user: { id: 'u1', roles: ['user'] }, token: 'test-token' },
    url: new URL(`http://localhost/app/org/${id}${search}`),
  } as unknown as Parameters<typeof load>[0];
}

function expectTwoCalls(ref: string, memories: { limit: number; offset: number }, agents: { limit: number; offset: number }) {
  expect(mockRequest).toHaveBeenCalledTimes(2);
  expect(mockRequest).toHaveBeenCalledWith(PUBLIC_ORGANIZATION_MEMORIES_QUERY, { ref, ...memories });
  expect(mockRequest).toHaveBeenCalledWith(PUBLIC_ORGANIZATION_AGENTS_QUERY, { ref, ...agents });
  expect(mockRequest.mock.calls.filter(([query]) => query === PUBLIC_ORGANIZATION_MEMORIES_QUERY)).toHaveLength(1);
  expect(mockRequest.mock.calls.filter(([query]) => query === PUBLIC_ORGANIZATION_AGENTS_QUERY)).toHaveLength(1);
}

describe('/app/org/[id] sanitized public organization loader (#1846 slice B)', () => {
  it('returns only PublicOrganization and forwards an id or URN ref with the caller token', async () => {
    succeed();
    await expect(load(ev('hrn:org:public.test'))).resolves.toEqual({
      organization,
      paging: { memories: { limit: 20, offset: 0 }, agents: { limit: 20, offset: 0 } },
      path: '/app/org/hrn:org:public.test',
      search: '',
    });
    expect(mockToken).toHaveBeenCalledExactlyOnceWith('test-token');
    expectTwoCalls('hrn:org:public.test', { limit: 20, offset: 0 }, { limit: 20, offset: 0 });
  });

  it('forwards independent user-requested limits and offsets in two bounded requests', async () => {
    succeed();
    const search = '?from=memory&memoriesLimit=500&memoriesOffset=40&agentsLimit=50&agentsOffset=60';
    await expect(load(ev('org-1', search))).resolves.toMatchObject({
      organization,
      paging: { memories: { limit: 500, offset: 40 }, agents: { limit: 50, offset: 60 } },
      path: '/app/org/org-1',
      search,
    });
    expectTwoCalls('org-1', { limit: 500, offset: 40 }, { limit: 50, offset: 60 });
  });

  it('normalizes invalid and non-positive parameters without count-only loops', async () => {
    succeed();
    await load(ev('org-1', '?memoriesLimit=0&memoriesOffset=-2&agentsLimit=2147483648&agentsOffset=bad'));
    expectTwoCalls('org-1', { limit: 20, offset: 0 }, { limit: 20, offset: 0 });
  });

  it('gives missing and non-discoverable organizations the same neutral 404', async () => {
    const errors: Array<{ status: number; body?: { message?: string } }> = [];
    for (const ref of ['missing-org', 'private-org']) {
      mockRequest.mockResolvedValue({ publicOrganization: null });
      try {
        await load(ev(ref));
        throw new Error('expected a 404');
      } catch (e) {
        errors.push(e as (typeof errors)[number]);
      }
    }
    expect(errors.map((e) => e.status)).toEqual([404, 404]);
    expect(errors[0].body?.message).toBe('Organization not found');
    expect(errors[1].body?.message).toBe(errors[0].body?.message);
  });

  it.each([
    ['memories', PUBLIC_ORGANIZATION_MEMORIES_QUERY],
    ['agents', PUBLIC_ORGANIZATION_AGENTS_QUERY],
  ])('propagates a %s failure instead of returning a false empty page or 404', async (kind, failedQuery) => {
    mockRequest.mockImplementation((query: string) => query === failedQuery
      ? Promise.reject(new Error(`${kind} outage`))
      : Promise.resolve({ publicOrganization: kind === 'memories' ? agentOrganization : memoryOrganization }));
    await expect(load(ev('org-1'))).rejects.toThrow(`${kind} outage`);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('selects exactly the closed PublicOrganization and PublicResourceRef page fields in each operation', () => {
    for (const [query, pageField] of [
      [PUBLIC_ORGANIZATION_MEMORIES_QUERY, 'publicMemoriesPage'],
      [PUBLIC_ORGANIZATION_AGENTS_QUERY, 'publicAgentsPage'],
    ] as const) {
      const selections: Record<string, string[]> = {};
      visit(parse(query), {
        Field(node) {
          if (node.name.value === 'publicOrganization') {
            selections.organization = node.selectionSet?.selections.map((s) => s.kind === 'Field' ? s.name.value : '<non-field>') ?? [];
          }
          if (node.name.value === pageField) {
            selections.page = node.selectionSet?.selections.map((s) => s.kind === 'Field' ? s.name.value : '<non-field>') ?? [];
          }
          if (node.name.value === 'items') {
            selections.items = node.selectionSet?.selections.map((s) => s.kind === 'Field' ? s.name.value : '<non-field>') ?? [];
          }
        },
      });
      expect(selections).toEqual({
        organization: ['id', 'name', 'urn', 'listedOnMarketplace', pageField],
        page: ['items', 'total', 'hasMore'],
        items: ['id', 'name', 'urn', 'description'],
      });
      expect(query).not.toMatch(/\borganization\s*\(/);
      expect(query).not.toMatch(/public(?:Memories|Agents)\s*\{/);
      for (const forbidden of ['members', 'apps', 'billing', 'credentials', 'subscriptions', 'exchangeConnections']) {
        expect(query).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
      }
    }
  });
});
