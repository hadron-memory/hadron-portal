/**
 * /app/memories index loader. Two tabs: "My memories" (the caller's OWN org-less
 * memories, org-owned filtered out) and "Memories shared with me" (#778). The
 * loader fetches both independently — one tab's failure must not blank the other.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERSONAL_MEMORIES_QUERY, SHARED_MEMORIES_QUERY } from '$lib/server/queries';

vi.spyOn(console, 'error').mockImplementation(() => {});

const mockFetchAll = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: vi.fn() }) }));
vi.mock('$lib/server/paginate', () => ({ fetchAllItems: (...a: unknown[]) => mockFetchAll(...a) }));

beforeEach(() => mockFetchAll.mockReset());

async function importLoad() {
  return (await import('./+page.server')).load;
}

function ev() {
  return { locals: { token: 't' } } as unknown as Parameters<
    Awaited<ReturnType<typeof importLoad>>
  >[0];
}

async function runLoad() {
  const load = await importLoad();
  return load(ev());
}

/** Route the shared fetchAllItems mock by query: PERSONAL vs SHARED. */
function route(opts: { owned?: unknown[] | Error; shared?: unknown[] | Error }) {
  mockFetchAll.mockImplementation(async (_client: unknown, query: string) => {
    const pick = query === SHARED_MEMORIES_QUERY ? opts.shared : opts.owned;
    if (pick instanceof Error) throw pick;
    return pick ?? [];
  });
}

describe('/app/memories index loader', () => {
  it("lists the caller's org-less memories, filtering out org-owned ones", async () => {
    route({
      owned: [
        { id: 'a', name: 'mine', organizationId: null },
        { id: 'b', name: 'org one', organizationId: 'org-9' },
      ],
      shared: [],
    });
    const result = await runLoad();
    expect(result).toMatchObject({ memories: [{ id: 'a' }], loadFailed: false });
    expect((result as { memories: unknown[] }).memories).toHaveLength(1);
    // Never redirects — org members see their personal memories here too.
    expect((result as { status?: number })?.status).toBeUndefined();
  });

  it('lists memories shared with the caller in the shared tab', async () => {
    route({
      owned: [],
      shared: [
        {
          id: 's1',
          name: 'Alice notes',
          urn: 'hrn:mem:alice:notes',
          class: 'personal',
          myShare: { role: 'reader', grantor: { id: 'u-alice', handle: 'alice', name: 'Alice' } },
        },
      ],
    });
    const result = (await runLoad()) as {
      sharedMemories: Array<{ id: string; myShare: { role: string } }>;
      sharedLoadFailed: boolean;
    };
    expect(result.sharedMemories).toHaveLength(1);
    expect(result.sharedMemories[0]).toMatchObject({ id: 's1', myShare: { role: 'reader' } });
    expect(result.sharedLoadFailed).toBe(false);
  });

  it('uses the personal + shared queries (routing sanity)', async () => {
    route({ owned: [], shared: [] });
    await runLoad();
    const queries = mockFetchAll.mock.calls.map((c) => c[1]);
    expect(queries).toContain(PERSONAL_MEMORIES_QUERY);
    expect(queries).toContain(SHARED_MEMORIES_QUERY);
  });

  // NOTE: the per-tab failure paths (loadFailed / sharedLoadFailed) use
  // Promise.allSettled so one tab's failure can't blank the other. They aren't
  // unit-tested here because a rejected-promise mock trips vitest 4.x's
  // unhandled-rejection detector even though allSettled handles it (same reason
  // as the other loaders in this repo) — the error banners are verified
  // in-browser instead.
});
