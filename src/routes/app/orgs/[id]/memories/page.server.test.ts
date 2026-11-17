/**
 * Spec 034-memory-class-access — memories-list loader.
 *
 * Verifies the new `personalMemories` surface: the loader pulls memories() and
 * filters to the caller's own personal memories (the personal + private
 * classes) whose container is the current org. Mocks `$lib/server/api`'s
 * `gqlClient` and routes by query identity, as in the sibling loader tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { expectDistinctFormIds } from '$lib/test/expectDistinctFormIds';
import {
  DELETE_MEMORY_MUTATION,
  DELETE_MEMORY_SUBSCRIPTION_MUTATION,
  ORG_MEMORIES_TAB_QUERY,
  ORG_SYSTEM_MEMORIES_QUERY,
  OWN_SYSTEM_MEMORY_IDS_QUERY,
  PUBLIC_MEMORIES_QUERY,
  MEMORIES_QUERY,
  CREATE_MEMORY_SUBSCRIPTION_MUTATION,
  SYNC_MEMORY_MUTATION,
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

async function runSubscribe(fields: Record<string, string>) {
  return runAction('subscribe', fields);
}

async function runAction(
  name: 'delete' | 'syncAll' | 'subscribe' | 'unsubscribe',
  fields: Record<string, string> = {},
) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return actions[name]({
    params: { id: 'org-1' },
    locals: { token: 'test-token' },
    request: { formData: async () => fd },
  } as never);
}

function ev(opts: { orgId?: string; userId?: string; tab?: string; org?: unknown } = {}) {
  const orgId = opts.orgId ?? 'org-1';
  const search = opts.tab ? `?tab=${opts.tab}` : '';
  return {
    params: { id: orgId },
    locals: { token: 'test-token', user: { id: opts.userId ?? 'u1' } },
    // #382: the org now arrives from the LAYOUT rather than from a second
    // ORG_MEMORIES_TAB_QUERY in this loader, so the parent stub has to supply it.
    // That the old `{}` stub stopped working is the contract change showing up.
    parent: async () => ({ org: opts.org ?? fakeOrg }),
    url: new URL(`https://x/app/orgs/${orgId}/memories${search}`),
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

const fakeOrg = {
  id: 'org-1', name: 'Acme', urn: 'urn:org:acme',
  members: [], memories: [], agents: [], subscriptions: [],
};

function routeMock(
  myMemories: unknown[],
  publicMemories: unknown[] = [],
  org: unknown = undefined,
  systemMemories: unknown[] = [],
  ownedSystemIds: string[] | Error = [],
) {
  mockRequest.mockImplementation(async (query: string) => {
    // #845: the loader fetches the org itself, so this is where a test injects
    // one — not through parent(), which now carries chrome only.
    if (query === ORG_MEMORIES_TAB_QUERY) return { organization: org ?? fakeOrg };
    if (query === ORG_SYSTEM_MEMORIES_QUERY) {
      return { memories: { items: systemMemories, total: systemMemories.length } };
    }
    if (query === OWN_SYSTEM_MEMORY_IDS_QUERY) {
      if (ownedSystemIds instanceof Error) throw ownedSystemIds;
      return { memories: { items: ownedSystemIds.map((id) => ({ id })), total: ownedSystemIds.length } };
    }
    if (query === PUBLIC_MEMORIES_QUERY) {
      return { memories: { items: publicMemories, total: publicMemories.length } };
    }
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
      if (query === ORG_MEMORIES_TAB_QUERY) return { organization: fakeOrg };
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

describe('memories-list load() — system rows stay inside this org (#2140)', () => {
  // The server's memories(orgId:) can return rows that are not this org's: an
  // App's install memory is unioned in for every App the caller reaches, in any
  // org, and the caller's own user-owned memories appear in every org context
  // (hrn:node:hadronmemory.com:specs:cor:api:100, hrn:node:hadronmemory.com:specs:cor:api:100:01,
  // hrn:node:hadronmemory.com:specs:cor:api:120:03). The tab captioned "owned by
  // this organization" must show only this org's rows.
  type Slices = { systemMemories: { id: string; name?: string }[]; personalMemories: { id: string; name?: string }[] };
  const ids = (rows: { id: string }[]) => rows.map((m) => m.id).sort();
  // Ownership of a system row is the SERVER's answer (memories(ownedByMe) +
  // memoryClasses system): Memory.userId is the personal/private owner only, so a
  // system row arrives with userId null and the client cannot tell whose it is.
  async function slices(system: unknown[], owned: string[] | Error = []): Promise<Slices> {
    routeMock([], [], undefined, system, owned);
    const load = await importLoad();
    return (await load(ev({ orgId: 'org-1', userId: 'u1' }))) as unknown as Slices;
  }

  it('drops an install memory of an App in another org', async () => {
    // Whoever asks (an org admin in B, an App owner in B, a platform admin), the
    // server hands the loader this same row, so one caller pins it; what the
    // loader must not do is show it.
    const r = await slices([
      { id: 'i-b', name: 'Product Team - install', class: 'system', organizationId: 'org-2', appId: 'app-b', userId: null },
    ]);
    expect(ids(r.systemMemories)).toEqual([]);
    expect(ids(r.personalMemories)).toEqual([]);
  });

  it('keeps this org\'s own system memories, including its App\'s install memory (#2044)', async () => {
    const r = await slices([
      { id: 's1', name: 'Org system', class: 'system', organizationId: 'org-1', appId: null, userId: null },
      { id: 'i-a', name: 'Org App install', class: 'system', organizationId: 'org-1', appId: 'app-a', userId: null },
      { id: 'i-b', name: 'Other org install', class: 'system', organizationId: 'org-2', appId: 'app-b', userId: null },
    ]);
    expect(ids(r.systemMemories)).toEqual(['i-a', 's1']);
    expect(ids(r.personalMemories)).toEqual([]);
  });

  it('sends an org-less system memory the server says the caller owns to Personal Memories, not Org Memories', async () => {
    // userId is null on a system row: the API cannot say whose it is, only the
    // ownedByMe slice can.
    const row = { id: 'flow-lab', name: 'flow-lab-system', class: 'system', organizationId: null, appId: null, userId: null };
    const r = await slices([row], ['flow-lab']);
    expect(ids(r.systemMemories)).toEqual([]);
    expect(ids(r.personalMemories)).toEqual(['flow-lab']);
  });

  it('shows an org-less system row to nobody the server does not name as its owner', async () => {
    // Also the install memory of a user-owned App the caller is only a member of:
    // org-less, readable, not theirs.
    const row = { id: 'theirs', name: 'Someone else', class: 'system', organizationId: null, appId: 'app-u', userId: null };
    const r = await slices([row], []);
    expect(ids(r.systemMemories)).toEqual([]);
    expect(ids(r.personalMemories)).toEqual([]);
  });

  it('drops the caller\'s own system row tied to another org', async () => {
    const r = await slices(
      [{ id: 'mine-b', name: 'Mine in B', class: 'system', organizationId: 'org-2', appId: null, userId: null }],
      ['mine-b'],
    );
    expect(ids(r.systemMemories)).toEqual([]);
    expect(ids(r.personalMemories)).toEqual([]);
  });

  it('never lists a row twice in Personal Memories, and takes only system class from the system read', async () => {
    // Overlap: the same id arrives from the personal/private read and from the
    // system read; and an org-less personal-class row arrives in the system
    // answer. Both would render twice if the slices were not kept disjoint.
    routeMock(
      [{ id: 'dup', name: 'Dup', class: 'private', organizationId: 'org-1', userId: 'u1' }],
      [],
      undefined,
      [
        { id: 'dup', name: 'Dup', class: 'system', organizationId: null, userId: null },
        { id: 'stray', name: 'Stray personal', class: 'personal', organizationId: null, userId: null },
      ],
      ['dup', 'stray'],
    );
    const load = await importLoad();
    const r = (await load(ev({ orgId: 'org-1', userId: 'u1' }))) as unknown as Slices;
    expect(r.personalMemories.map((m) => m.id)).toEqual(['dup']);
  });

  it('an org-owned system row stays in Org Memories even when the caller owns it too', async () => {
    const r = await slices(
      [{ id: 'both', name: 'Org + user', class: 'system', organizationId: 'org-1', appId: null, userId: null }],
      ['both'],
    );
    expect(ids(r.systemMemories)).toEqual(['both']);
    expect(ids(r.personalMemories)).toEqual([]);
  });

  it('a failed ownership read hides the org-less rows, it does not leak them, and does not throw', async () => {
    const r = await slices(
      [
        { id: 'flow-lab', name: 'flow-lab-system', class: 'system', organizationId: null, userId: null },
        { id: 's1', name: 'Org system', class: 'system', organizationId: 'org-1', userId: null },
      ],
      new Error('boom'),
    );
    expect(ids(r.systemMemories)).toEqual(['s1']);
    expect(ids(r.personalMemories)).toEqual([]);
  });

  it('a failed system read still degrades to empty slices without throwing', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === ORG_MEMORIES_TAB_QUERY) return { organization: fakeOrg };
      if (query === ORG_SYSTEM_MEMORIES_QUERY) throw new Error('boom');
      if (query === PUBLIC_MEMORIES_QUERY) return { memories: { items: [], total: 0 } };
      if (query === MEMORIES_QUERY) return { memories: { items: [], total: 0 } };
      throw new Error('Unexpected query');
    });
    const load = await importLoad();
    const r = (await load(ev())) as unknown as Slices;
    expect(r.systemMemories).toEqual([]);
    expect(r.personalMemories).toEqual([]);
  });

  // portal#2175 (FIT 6884373873 a): the system read is paginated, so the same
  // id can arrive twice — a row shifting across a page boundary mid-fetch. A
  // duplicate must list once and land in the tab its OWNER fields give it (the
  // #2147 rule), never move between tabs.
  it('a duplicated systemRows id lists once, in the tab it would land in without the duplicate', async () => {
    // The two copies of each id DIFFER in a payload field (a shifted row can
    // re-read with a newer name): first occurrence wins, and the row keeps the
    // tab its owner fields give it either way.
    const r = await slices(
      [
        { id: 's1', name: 'Org system', class: 'system', organizationId: 'org-1', appId: null, userId: null },
        { id: 's1', name: 'Org system v2', class: 'system', organizationId: 'org-1', appId: null, userId: null },
        { id: 'flow-lab', name: 'flow-lab-system', class: 'system', organizationId: null, appId: null, userId: null },
        { id: 'flow-lab', name: 'flow-lab-system v2', class: 'system', organizationId: null, appId: null, userId: null },
      ],
      ['flow-lab'],
    );
    // The control is the tests above: s1 (this org) → Org Memories, flow-lab
    // (org-less, owned) → Personal Memories. The duplicates change nothing,
    // and the FIRST copy is the one that survives.
    expect(ids(r.systemMemories)).toEqual(['s1']);
    expect(r.systemMemories.find((m) => m.id === 's1')?.name).toBe('Org system');
    expect(ids(r.personalMemories)).toEqual(['flow-lab']);
    expect(r.personalMemories.find((m) => m.id === 'flow-lab')?.name).toBe('flow-lab-system');
  });

  // portal#2175: the OTHER paged reads this loader consumes can hand back the
  // same id twice the same way. The "never listed twice" invariant covers them
  // too, not just systemRows.
  it('a duplicated memories() id lists once in Personal Memories', async () => {
    routeMock(
      [
        { id: 'p1', name: 'Mine private', organizationId: 'org-1', userId: 'u1', class: 'private' },
        { id: 'p1', name: 'Mine private', organizationId: 'org-1', userId: 'u1', class: 'private' },
        { id: 'p2', name: 'Mine personal', organizationId: 'org-1', userId: 'u1', class: 'personal' },
      ],
    );
    const load = await importLoad();
    const r = (await load(ev({ orgId: 'org-1', userId: 'u1' }))) as { personalMemories: { id: string }[] };
    expect(r.personalMemories.map((m) => m.id).sort()).toEqual(['p1', 'p2']);
  });

  it('a duplicated publicMemories id is offered once in availableMemories (the subscribe picker)', async () => {
    routeMock(
      [],
      [
        { id: 'pub-1', name: 'Shared One', organizationId: 'org-9' },
        { id: 'pub-1', name: 'Shared One', organizationId: 'org-9' },
        { id: 'pub-2', name: 'Shared Two', organizationId: 'org-9' },
      ],
    );
    const load = await importLoad();
    const r = (await load(ev({ orgId: 'org-1', userId: 'u1' }))) as { availableMemories: { id: string }[] };
    expect(r.availableMemories.map((m) => m.id).sort()).toEqual(['pub-1', 'pub-2']);
  });
});

// portal#2175 (FIT 6884373873 c): a degraded read stays fail-closed (the tests
// above pin the fallbacks) but is no longer silent — each failing read logs one
// warn naming itself and the org plus the error's code or transport class.
// Nothing else from the error prints: a ClientError's message/stack carry the
// request/response payloads (bearer token, row content) —
// hrn:node:hadronmemory.com:hadron-portal:findings:custom-handle-error-replaces-framework-copy-and-logging.
// The failure is also no longer reader-indistinguishable from empty: every
// list the failed read feeds carries a degraded flag, so the page can trade
// its empty-state copy for truthful unavailable copy (pinned mounted in
// page.client.test.ts — the acceptance's "never renders as no memories").
describe('memories-list load() — degraded reads log (portal#2175)', () => {
  // The spy is created here and restored here: vi.restoreAllMocks would also
  // wipe the module-factory mocks for later tests (they only survive today
  // because an undefined requireNonConsumer happens to await fine), so restore
  // ONLY the console spy even when an assertion fails first.
  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('an uncoded plain-Error failure logs the read name, the org, and the error class name', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === ORG_MEMORIES_TAB_QUERY) return { organization: fakeOrg };
      if (query === ORG_SYSTEM_MEMORIES_QUERY) return { memories: { items: [], total: 0 } };
      if (query === OWN_SYSTEM_MEMORY_IDS_QUERY) return { memories: { items: [], total: 0 } };
      if (query === PUBLIC_MEMORIES_QUERY) return { memories: { items: [], total: 0 } };
      if (query === MEMORIES_QUERY) throw new Error('boom');
      throw new Error('Unexpected query');
    });
    const load = await importLoad();
    const r = (await load(ev())) as unknown as {
      personalMemories: unknown[];
      systemMemoriesDegraded: boolean;
      personalMemoriesDegraded: boolean;
      availableMemoriesDegraded: boolean;
    };
    expect(r.personalMemories).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    // The label is the error's class, not 'transport': a plain Error here is
    // (e.g.) the pager's own envelope bug, not a network problem.
    expect(warn).toHaveBeenCalledWith('[org-memories] my memories read failed for org-1 (Error); rows hidden, fail-closed');
    // Only the list this read feeds is flagged.
    expect(r.personalMemoriesDegraded).toBe(true);
    expect(r.systemMemoriesDegraded).toBe(false);
    expect(r.availableMemoriesDegraded).toBe(false);
  });

  // The acceptance's named read: a failed OWNERSHIP read. Its rows hide
  // (fail-closed, pinned above) and it flags exactly the personal tab — the
  // tab whose rows it feeds — not the org or subscribe-picker lists.
  it('a failed ownership read flags only the personal list it feeds', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === ORG_MEMORIES_TAB_QUERY) return { organization: fakeOrg };
      if (query === ORG_SYSTEM_MEMORIES_QUERY) return { memories: { items: [], total: 0 } };
      if (query === OWN_SYSTEM_MEMORY_IDS_QUERY) throw new Error('ownership read down');
      if (query === PUBLIC_MEMORIES_QUERY) return { memories: { items: [], total: 0 } };
      if (query === MEMORIES_QUERY) return { memories: { items: [], total: 0 } };
      throw new Error('Unexpected query');
    });
    const load = await importLoad();
    const r = (await load(ev())) as unknown as {
      personalMemories: unknown[];
      systemMemoriesDegraded: boolean;
      personalMemoriesDegraded: boolean;
      availableMemoriesDegraded: boolean;
    };
    expect(r.personalMemories).toEqual([]);
    expect(r.personalMemoriesDegraded).toBe(true);
    expect(r.systemMemoriesDegraded).toBe(false);
    expect(r.availableMemoriesDegraded).toBe(false);
  });

  // The org-system read feeds BOTH tabs (systemMemories directly, and the
  // caller's own org-less system rows on the personal tab via ownSystemIds),
  // so its failure flags both.
  it('a failed org-system read flags both lists it feeds', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === ORG_MEMORIES_TAB_QUERY) return { organization: fakeOrg };
      if (query === ORG_SYSTEM_MEMORIES_QUERY) throw new Error('system read down');
      if (query === OWN_SYSTEM_MEMORY_IDS_QUERY) return { memories: { items: [], total: 0 } };
      if (query === PUBLIC_MEMORIES_QUERY) return { memories: { items: [], total: 0 } };
      if (query === MEMORIES_QUERY) return { memories: { items: [], total: 0 } };
      throw new Error('Unexpected query');
    });
    const load = await importLoad();
    const r = (await load(ev())) as unknown as {
      systemMemoriesDegraded: boolean;
      personalMemoriesDegraded: boolean;
      availableMemoriesDegraded: boolean;
    };
    expect(r.systemMemoriesDegraded).toBe(true);
    expect(r.personalMemoriesDegraded).toBe(true);
    expect(r.availableMemoriesDegraded).toBe(false);
  });

  it('a coded GraphQL failure logs the code, and every degraded read logs once — never the token, the raw message, or row content', async () => {
    // The shape graphql-request throws: the code lives on
    // response.errors[0].extensions.code. The message and response body carry
    // the bearer token — exactly what must NOT print, so the error is built to
    // fail the assertion if any of it leaks.
    const coded = {
      message: 'FORBIDDEN: bearer test-token rejected',
      response: { errors: [{ message: 'FORBIDDEN: bearer test-token rejected', extensions: { code: 'FORBIDDEN' } }] },
    };
    mockRequest.mockImplementation(async (query: string) => {
      if (query === ORG_MEMORIES_TAB_QUERY) return { organization: fakeOrg };
      if (query === ORG_SYSTEM_MEMORIES_QUERY) throw coded;
      if (query === OWN_SYSTEM_MEMORY_IDS_QUERY) throw coded;
      if (query === PUBLIC_MEMORIES_QUERY) throw coded;
      if (query === MEMORIES_QUERY) throw coded;
      throw new Error('Unexpected query');
    });
    const load = await importLoad();
    const r = (await load(ev())) as unknown as {
      systemMemories: unknown[];
      personalMemories: unknown[];
      systemMemoriesDegraded: boolean;
      personalMemoriesDegraded: boolean;
      availableMemoriesDegraded: boolean;
    };
    // Fail-closed unchanged: every degraded read still hides its rows.
    expect(r.systemMemories).toEqual([]);
    expect(r.personalMemories).toEqual([]);
    // Every list is flagged for its unavailable-state copy.
    expect(r.systemMemoriesDegraded).toBe(true);
    expect(r.personalMemoriesDegraded).toBe(true);
    expect(r.availableMemoriesDegraded).toBe(true);
    expect(warn).toHaveBeenCalledTimes(4);
    const lines = warn.mock.calls.map((c) => c.join(' ')).sort();
    expect(lines).toEqual([
      '[org-memories] my memories read failed for org-1 (FORBIDDEN); rows hidden, fail-closed',
      '[org-memories] org system memories read failed for org-1 (FORBIDDEN); rows hidden, fail-closed',
      '[org-memories] own system-memory ids read failed for org-1 (FORBIDDEN); rows hidden, fail-closed',
      '[org-memories] public memories read failed for org-1 (FORBIDDEN); rows hidden, fail-closed',
    ]);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('test-token');
    expect(logged).not.toContain('rejected');
  });
});

describe('memories-list load() — initialTab (#556)', () => {
  it('defaults to the org tab with no ?tab= hint, and a healthy load flags no list degraded', async () => {
    routeMock([]);
    const load = await importLoad();
    const result = (await load(ev())) as {
      initialTab: string;
      systemMemoriesDegraded: boolean;
      personalMemoriesDegraded: boolean;
      availableMemoriesDegraded: boolean;
    };
    expect(result.initialTab).toBe('org');
    expect(result.systemMemoriesDegraded).toBe(false);
    expect(result.personalMemoriesDegraded).toBe(false);
    expect(result.availableMemoriesDegraded).toBe(false);
  });

  it('honors ?tab=personal (the create-flow deep link)', async () => {
    routeMock([]);
    const load = await importLoad();
    const result = (await load(ev({ tab: 'personal' }))) as { initialTab: string };
    expect(result.initialTab).toBe('personal');
  });

  it('falls back to org for an unknown ?tab= value', async () => {
    routeMock([]);
    const load = await importLoad();
    const result = (await load(ev({ tab: 'bogus' }))) as { initialTab: string };
    expect(result.initialTab).toBe('org');
  });

  it('seeds the action forms with explicit defaults', async () => {
    routeMock([]);
    const load = await importLoad();
    const result = (await load(ev())) as {
      subscribeForm: { data: { memoryId: string; role: string } };
      deleteForm: { data: { id: string } };
      syncAllForm: { data: { _kind: string } };
      unsubscribeForm: { data: { memoryId: string } };
    };
    expectDistinctFormIds(result, 4);
    expect(result.subscribeForm.data).toMatchObject({ memoryId: '', role: 'READER' });
    expect(result.deleteForm.data.id).toBe('');
    expect(result.syncAllForm.data._kind).toBe('syncMemories');
    expect(result.unsubscribeForm.data.memoryId).toBe('');
  });
});

describe('memories-list delete action', () => {
  it('deletes a memory from a validated Superform', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('delete', { id: ' mem-1 ' });

    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'deleteMemory', id: 'mem-1' },
        message: { type: 'success', text: 'Memory deleted.' },
      },
    });
    expect(mockRequest).toHaveBeenCalledWith(DELETE_MEMORY_MUTATION, { id: 'mem-1' });
  });

  it('rejects omitted delete ids before mutation', async () => {
    const result = (await runAction('delete', {})) as {
      status: number;
      data: { form: { errors: { id?: string[] } } };
    };

    expect(result.status).toBe(400);
    expect(result.data.form.errors.id?.[0]).toBe('Memory is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects delete POSTs with the wrong form discriminator', async () => {
    const result = (await runAction('delete', {
      _kind: 'subscribeMemory',
      id: 'mem-1',
    })) as { status: number; data: { form: { errors: { _kind?: string[] } } } };

    expect(result.status).toBe(400);
    expect(result.data.form.errors._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns typed delete errors', async () => {
    mockRequest.mockRejectedValueOnce(new Error('nope'));
    const result = (await runAction('delete', { id: 'mem-1' })) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };

    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
  });
});

describe('memories-list syncAll action', () => {
  it('syncs only source-backed memories and returns typed feedback', async () => {
    mockRequest.mockResolvedValueOnce({
      organization: {
        memories: [
          { id: 'mem-1', name: 'Git One', source: { type: 'git' } },
          { id: 'mem-2', name: 'Database Only', source: null },
          { id: 'mem-3', name: 'Git Two', source: { type: 'git' } },
        ],
      },
    });
    // The real SYNC_MEMORY_MUTATION response carries MemoryFields' syncStatus.
    mockRequest.mockResolvedValueOnce({ syncMemory: { id: 'mem-1', syncStatus: 'OK', lastSyncReport: null, lastSyncedAt: '2026-10-26T01:02:03.000Z' } });
    mockRequest.mockResolvedValueOnce({ syncMemory: { id: 'mem-3', syncStatus: 'OK', lastSyncReport: null, lastSyncedAt: '2026-10-26T01:02:03.000Z' } });

    const result = await runAction('syncAll', {});

    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'syncMemories' },
        message: { type: 'success', text: 'All memories synced.' },
      },
    });
    expect(mockRequest.mock.calls).toEqual([
      // The action fetches the memories SLICE too (#845): it runs before the
      // layout load so it has no parent(), but it has no business invoking
      // `exchangeConnections` either.
      [ORG_MEMORIES_TAB_QUERY, { ref: 'org-1' }],
      [SYNC_MEMORY_MUTATION, { id: 'mem-1' }],
      [SYNC_MEMORY_MUTATION, { id: 'mem-3' }],
    ]);
  });

  it('rejects syncAll POSTs with the wrong form discriminator', async () => {
    const result = (await runAction('syncAll', {
      _kind: 'deleteMemory',
    })) as { status: number; data: { form: { errors: { _kind?: string[] } } } };

    expect(result.status).toBe(400);
    expect(result.data.form.errors._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns typed aggregate sync errors', async () => {
    mockRequest.mockResolvedValueOnce({
      organization: {
        memories: [
          { id: 'mem-1', name: 'Git One', source: { type: 'git' } },
          { id: 'mem-2', name: 'Git Two', source: { type: 'git' } },
        ],
      },
    });
    mockRequest.mockResolvedValueOnce({ syncMemory: { id: 'mem-1', syncStatus: 'OK', lastSyncReport: null, lastSyncedAt: '2026-10-26T01:02:03.000Z' } });
    mockRequest.mockRejectedValueOnce(new Error('nope'));

    const result = (await runAction('syncAll', {})) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };

    expect(result.status).toBe(500);
    expect(result.data.form.message.type).toBe('error');
    expect(result.data.form.message.text).toContain('Git Two: The last sync failed.');
    expect(result.data.form.message.text).not.toContain('nope');
  });

  it('never shows a credential from a member memory’s raw git error (#988, Gene on #989)', async () => {
    mockRequest.mockResolvedValueOnce({ organization: { memories: [{ id: 'mem-1', name: 'Git One', source: { type: 'git' } }] } });
    mockRequest.mockRejectedValueOnce(new Error(
      'Command failed: git clone --branch nope -- https://x-access-token:ghs_ORGsecretORGsecret77@github.com/acme/r.git /tmp\nfatal: Remote branch nope not found',
    ));
    const result = (await runAction('syncAll', {})) as { data: { form: { message: { text: string } } } };
    expect(result.data.form.message.text).not.toContain('ghs_ORG');
    expect(result.data.form.message.text).not.toContain('github.com');
    expect(result.data.form.message.text).toContain('Git One:');
  });

  it('does not claim "all synced" when a sync came back unfinished (#988)', async () => {
    mockRequest.mockResolvedValueOnce({ organization: { memories: [{ id: 'mem-1', name: 'Git One', source: { type: 'git' } }] } });
    mockRequest.mockResolvedValueOnce({ syncMemory: { id: 'mem-1', syncStatus: 'SYNCING' } });
    const result = (await runAction('syncAll', {})) as { form: { message: { text: string } } };
    expect(result.form.message.text).not.toBe('All memories synced.');
    expect(result.form.message.text).toContain('Git One');
  });

  it('returns a typed error when listing sync candidates fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('nope'));

    const result = (await runAction('syncAll', {})) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };

    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith(ORG_MEMORIES_TAB_QUERY, { ref: 'org-1' });
  });
});

describe('memories-list subscribe action', () => {
  it('subscribes to a public memory from a validated Superform', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runSubscribe({ memoryId: 'mem-1', role: 'CONTRIBUTOR' });

    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'subscribeMemory', memoryId: 'mem-1', role: 'CONTRIBUTOR' },
        message: { type: 'success', text: 'Subscribed to memory.' },
      },
    });
    expect(mockRequest).toHaveBeenCalledWith(CREATE_MEMORY_SUBSCRIPTION_MUTATION, {
      memoryId: 'mem-1',
      orgId: 'org-1',
      role: 'CONTRIBUTOR',
    });
  });

  it('rejects omitted memory ids before mutation', async () => {
    const result = (await runSubscribe({ role: 'READER' })) as {
      status: number;
      data: { form: { errors: { memoryId?: string[] } } };
    };

    expect(result.status).toBe(400);
    expect(result.data.form.errors.memoryId?.[0]).toBe('Select a public memory.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects subscribe POSTs with the wrong form discriminator', async () => {
    const result = (await runSubscribe({
      _kind: 'unsubscribe',
      memoryId: 'mem-1',
      role: 'READER',
    })) as { status: number; data: { form: { errors: { _kind?: string[] } } } };

    expect(result.status).toBe(400);
    expect(result.data.form.errors._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects elevated role tampering before mutation', async () => {
    const result = (await runSubscribe({
      memoryId: 'mem-1',
      role: 'OWNER',
    })) as { status: number; data: { form: { errors: { role?: string[] } } } };

    expect(result.status).toBe(400);
    expect(result.data.form.errors.role).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error when subscription fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('nope'));
    const result = (await runSubscribe({ memoryId: 'mem-1', role: 'READER' })) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };

    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
  });
});

describe('memories-list unsubscribe action', () => {
  it('unsubscribes from a memory with validated Superforms data', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('unsubscribe', { memoryId: ' mem-1 ' });

    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'unsubscribeMemory', memoryId: 'mem-1' },
        message: { type: 'success', text: 'Unsubscribed from memory.' },
      },
    });
    expect(mockRequest).toHaveBeenCalledWith(DELETE_MEMORY_SUBSCRIPTION_MUTATION, {
      memoryId: 'mem-1',
      orgId: 'org-1',
    });
  });

  it('rejects omitted unsubscribe memory ids before mutation', async () => {
    const result = (await runAction('unsubscribe', {})) as {
      status: number;
      data: { form: { errors: { memoryId?: string[] } } };
    };

    expect(result.status).toBe(400);
    expect(result.data.form.errors.memoryId?.[0]).toBe('Memory is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects unsubscribe POSTs with the wrong form discriminator', async () => {
    const result = (await runAction('unsubscribe', {
      _kind: 'deleteMemory',
      memoryId: 'mem-1',
    })) as { status: number; data: { form: { errors: { _kind?: string[] } } } };

    expect(result.status).toBe(400);
    expect(result.data.form.errors._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns typed unsubscribe errors', async () => {
    mockRequest.mockRejectedValueOnce(new Error('nope'));
    const result = (await runAction('unsubscribe', { memoryId: 'mem-1' })) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };

    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
  });
});

/**
 * #382 — the loader must NOT re-fetch the organization.
 *
 * The org layout already runs ORG_MEMORIES_TAB_QUERY for this same `params.id` on
 * this same request; this loader used to run it again, and used its result for
 * the owned/subscribed exclusion sets.
 *
 * The LOAD is pinned here. The ACTIONS deliberately still fetch the org
 * themselves and must: a form POST runs the action BEFORE the layout load
 * re-runs, so `parent()` is not available to them — which is why this asserts
 * on `load` alone rather than on the module.
 */
describe('org memories load() — the org comes from THIS LOADER (#382 → #845)', () => {
  // #382/#842 pinned the opposite here: the org came from parent() and this
  // loader issued no ORG_MEMORIES_TAB_QUERY. #845 had to invert it. The layout now
  // fetches chrome only (id/name/urn), because every nested field on
  // Organization is non-null while `organization(ref:)` is nullable — so one
  // list resolver failing propagated its null up to `organization` and the
  // layout's 404 replaced every tab of the org. This tab reads `memories` and
  // `subscriptions`, so it asks for them itself and a failure stops here.
  it('issues its own ORG_MEMORIES_TAB_QUERY, since the layout no longer carries the lists', async () => {
    routeMock([]);
    const load = await importLoad();
    const result = (await load(ev())) as unknown as { org: unknown };

    expect(result.org).toEqual(fakeOrg);
    expect(mockRequest.mock.calls.filter(([q]) => q === ORG_MEMORIES_TAB_QUERY)).toHaveLength(1);
    // Still asks for what it also needs, so "queried nothing" cannot pass this.
    expect(mockRequest.mock.calls.filter(([q]) => q === MEMORIES_QUERY)).toHaveLength(1);
  });

  it('ignores an org handed down by parent(), which now carries chrome only', async () => {
    // The direction that would silently rot: if this loader kept reading
    // parent(), it would get an object with no `memories` at all and every
    // exclusion below would pass vacuously. Handing it a DIFFERENT org proves
    // the fetched one is what is used.
    routeMock([]);
    const load = await importLoad();
    const result = (await load(
      ev({ org: { id: 'someone-else', name: 'Wrong', urn: 'urn:org:wrong' } }),
    )) as unknown as { org: { id: string } };
    expect(result.org.id).toBe('org-1');
  });

  it('still exposes the exclusion sets built from that org', async () => {
    // The org THIS LOADER fetches is what feeds availableMemories, so a loader
    // that fetched it and ignored it fails here rather than passing the count
    // check above.
    //
    // The public list must actually CONTAIN the excluded row, or `.some()` is
    // false because the list is empty and the assertion never reaches the
    // exclusion at all (hrn:node:hadronmemory.com:hadron-portal:review:a-spare-test-must-reach-the-matcher —
    // the first draft of this test did exactly that).
    const publicRows = [
      { id: 'pub-1', name: 'Owned by this org', organizationId: 'org-9' },
      { id: 'pub-2', name: 'Genuinely available', organizationId: 'org-9' },
    ];
    routeMock([], publicRows, { ...fakeOrg, memories: [{ id: 'pub-1' }] });
    const load = await importLoad();
    const result = (await load(ev())) as unknown as { availableMemories: Array<{ id: string }> };

    // pub-1 is excluded BECAUSE the org this loader fetched owns it …
    expect(result.availableMemories.map((m) => m.id)).not.toContain('pub-1');
    // … and pub-2 survives, which proves the filter ran rather than the list
    // being empty.
    expect(result.availableMemories.map((m) => m.id)).toContain('pub-2');
  });
});

describe('syncAll stored report', () => {
  it.each(['partial', 'unknown', 'malformed', 'omitted'])('lists %s as notes, never all clean', async outcome => {
    const at = '2026-10-26T01:02:03.000Z';
    mockRequest.mockResolvedValueOnce({ organization: { memories: [{ id: 'm', name: 'Docs', source: 'synthetic' }] } });
    mockRequest.mockResolvedValueOnce({ syncMemory: { syncStatus: 'OK', lastSyncedAt: at, ...(outcome === 'omitted' ? {} : { lastSyncReport: outcome === 'malformed' ? 'ghs_SECRET' : JSON.stringify({ version: 1, outcome, recordedAt: at, entries: [] }) }) } });
    const result = await runAction('syncAll') as { form: { message: { type: string; text: string } } };
    expect(result.form.message.type).toBe('success'); expect(result.form.message.text).toContain('Synced with notes: Docs');
    expect(result.form.message.text).not.toContain('All memories synced.'); expect(result.form.message.text).not.toContain('ghs_SECRET');
  });
});

it('returned failed reports stay sanitized errors in syncAll', async () => {
  mockRequest.mockResolvedValueOnce({ organization: { memories: [{ id: 'm', name: 'Docs', source: 'synthetic' }] } });
  mockRequest.mockResolvedValueOnce({ syncMemory: { syncStatus: 'ERROR', syncError: 'https://user:ghs_SECRET@github.com/a', lastSyncReport: JSON.stringify({ version: 1, outcome: 'failed', recordedAt: '2026-10-26T01:02:03.000Z', entries: [], code: 'SYNC_FAILED' }) } });
  const result = await runAction('syncAll') as { status: number; data: { form: { message: { type: string; text: string } } } };
  expect(result.status).toBe(500); expect(result.data.form.message.type).toBe('error'); expect(result.data.form.message.text).not.toContain('ghs_SECRET');
});


it('#1308 classifies each bulk result once', async () => {
  const raw = JSON.stringify({ version: 1, outcome: 'partial', recordedAt: '2026-10-26T01:02:03.000Z', entries: [] });
  mockRequest.mockResolvedValueOnce({ organization: { memories: [{ id: 'm', name: 'Docs', source: 'synthetic' }] } });
  mockRequest.mockResolvedValueOnce({ syncMemory: { syncStatus: 'OK', lastSyncReport: raw } });
  const parsed = vi.spyOn(JSON, 'parse');
  try {
    await runAction('syncAll');
    expect(parsed.mock.calls.filter(([input]) => input === raw)).toHaveLength(1);
  } finally { parsed.mockRestore(); }
});


it('#1308 bulk OK without completion reports uncertainty, not failure to finish', async () => {
  mockRequest.mockResolvedValueOnce({ organization: { memories: [{ id: 'm', name: 'Docs', source: 'synthetic' }] } });
  mockRequest.mockResolvedValueOnce({ syncMemory: { syncStatus: 'OK', lastSyncReport: null, lastSyncedAt: null } });
  const result = await runAction('syncAll') as { form: { message: { type: string; text: string } } };
  expect(result.form.message.text).toContain('Clean completed syncs are not confirmed for: Docs.');
  expect(result.form.message.text).not.toContain('didn’t finish');
  expect(result.form.message.text).not.toContain('All memories synced.');
});
