/**
 * Spec 034-memory-class-access — memories-list loader.
 *
 * Verifies the new `personalMemories` surface: the loader pulls memories() and
 * filters to the caller's own personal memories (the personal + private
 * classes) whose container is the current org. Mocks `$lib/server/api`'s
 * `gqlClient` and routes by query identity, as in the sibling loader tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ORGANIZATION_QUERY,
  ORG_SYSTEM_MEMORIES_QUERY,
  PUBLIC_MEMORIES_QUERY,
  MEMORIES_QUERY,
} from '$lib/server/queries';

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

function ev(opts: { orgId?: string; userId?: string } = {}) {
  return {
    params: { id: opts.orgId ?? 'org-1' },
    locals: { token: 'test-token', user: { id: opts.userId ?? 'u1' } },
    parent: async () => ({}),
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

const fakeOrg = {
  id: 'org-1', name: 'Acme', urn: 'urn:org:acme',
  members: [], memories: [], agents: [], subscriptions: [],
};

function routeMock(myMemories: unknown[]) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === ORGANIZATION_QUERY) return { organization: fakeOrg };
    if (query === ORG_SYSTEM_MEMORIES_QUERY) return { memories: { items: [], total: 0 } };
    if (query === PUBLIC_MEMORIES_QUERY) return { memories: { items: [], total: 0 } };
    if (query === MEMORIES_QUERY) return { memories: { items: myMemories, total: myMemories.length } };
    throw new Error('Unexpected query');
  });
}

describe('memories-list load() — personalMemories (spec 034)', () => {
  it('keeps only this user\'s personal memories whose container is this org', async () => {
    routeMock([
      { id: 'p1', name: 'Mine private', organizationId: 'org-1', userId: 'u1', class: 'private' },
      { id: 'p2', name: 'Mine personal', organizationId: 'org-1', userId: 'u1', class: 'personal' },
      { id: 'k1', name: 'Org knowledge', organizationId: 'org-1', userId: null, class: 'knowledge' },
      { id: 'p3', name: 'Other org private', organizationId: 'org-2', userId: 'u1', class: 'private' },
      { id: 'p4', name: 'Other user private', organizationId: 'org-1', userId: 'u2', class: 'private' },
    ]);
    const load = await importLoad();
    const result = (await load(ev({ orgId: 'org-1', userId: 'u1' }))) as { personalMemories: { id: string }[] };
    expect(result.personalMemories.map((m) => m.id).sort()).toEqual(['p1', 'p2']);
  });

  it('memories() failure degrades to an empty personalMemories list (no throw)', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === ORGANIZATION_QUERY) return { organization: fakeOrg };
      if (query === ORG_SYSTEM_MEMORIES_QUERY) return { memories: { items: [], total: 0 } };
      if (query === PUBLIC_MEMORIES_QUERY) return { memories: { items: [], total: 0 } };
      if (query === MEMORIES_QUERY) throw new Error('boom');
      throw new Error('Unexpected query');
    });
    const load = await importLoad();
    const result = (await load(ev())) as { personalMemories: unknown[] };
    expect(result.personalMemories).toEqual([]);
  });
});
