/**
 * fetchOwnedMemories / fetchSharedMemories — the two memory fetchers behind the
 * tabbed /app/memories page. Shared (#778) lists grantee memories via the
 * sharedWithMe query.
 *
 * #1176: owned is now ASKED FOR rather than computed. The loader used to fetch
 * `memoryClasses: [personal, private]` and re-filter on `organizationId == null`
 * in the client, and the class half was a proxy for ownership that stopped
 * holding once a `knowledge` memory could be user-owned — two of @Holger's four
 * memories were invisible with no error anywhere.
 *
 * So the tests split the same way the code does: the loader is a pass-through,
 * and the CONTRACT lives in the query text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOwnedMemories, fetchSharedMemories } from './personal-memories';
import {
  DASHBOARD_QUERY,
  PERSONAL_MEMORIES_LITE_QUERY,
  PERSONAL_MEMORIES_QUERY,
  SHARED_MEMORIES_QUERY,
} from './queries';

const mockFetchAll = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: vi.fn() }) }));
vi.mock('$lib/server/paginate', () => ({ fetchAllItems: (...a: unknown[]) => mockFetchAll(...a) }));

beforeEach(() => {
  mockFetchAll.mockReset();
});

describe('fetchOwnedMemories', () => {
  it('passes the server slice through — the filtering is no longer the client’s', async () => {
    // Ownership is NOT derivable from the fields the API exposes: `userId` is
    // visible and is the personal/private owner only, while every other class
    // keys on `ownerUserId`, which is not in the SDL at all. A client that
    // computed the slice would be guessing; `ownedByMe` is org-less BY
    // DEFINITION, so there is nothing left to repair.
    const rows = [
      { id: 'personal', organizationId: null },
      { id: 'knowledge', organizationId: null },
    ];
    mockFetchAll.mockResolvedValue(rows);
    expect(await fetchOwnedMemories('t')).toEqual(rows);
  });

  it('uses the personal-memories query', async () => {
    mockFetchAll.mockResolvedValue([]);
    await fetchOwnedMemories('t');
    expect(mockFetchAll.mock.calls[0][1]).toBe(PERSONAL_MEMORIES_QUERY);
  });
});

describe('fetchSharedMemories', () => {
  it('passes shared items through and uses the shared-memories query', async () => {
    const rows = [{ id: 's1', myShare: { role: 'reader', grantor: { id: 'u', handle: 'a', name: 'A' } } }];
    mockFetchAll.mockResolvedValue(rows);
    expect(await fetchSharedMemories('t')).toEqual(rows);
    expect(mockFetchAll.mock.calls[0][1]).toBe(SHARED_MEMORIES_QUERY);
  });
});

/**
 * The contract moved into the query, so this is where it is pinned.
 *
 * @Dara's acceptance criterion (server #1215): the population is what the page
 * showed before PLUS user-owned non-personal rows, and an ORG-OWNED personal
 * memory is still excluded. `ownedByMe` carries both halves — it is
 * `organizationId IS NULL AND the caller owns it`, per class — which is exactly
 * why the class pair had to go rather than be widened.
 */
describe('the owned-memories slice is ASKED FOR, not computed', () => {
  const asksOwnedByMe = (q: string) => /memories\(\s*filter:\s*\{\s*ownedByMe:\s*true\s*\}/.test(q);

  it.each([
    ['PERSONAL_MEMORIES_QUERY', PERSONAL_MEMORIES_QUERY],
    ['PERSONAL_MEMORIES_LITE_QUERY', PERSONAL_MEMORIES_LITE_QUERY],
    ['DASHBOARD_QUERY', DASHBOARD_QUERY],
  ])('%s asks the server for ownedByMe', (_name, q) => {
    expect(asksOwnedByMe(q)).toBe(true);
  });

  it.each([
    ['PERSONAL_MEMORIES_QUERY', PERSONAL_MEMORIES_QUERY],
    ['PERSONAL_MEMORIES_LITE_QUERY', PERSONAL_MEMORIES_LITE_QUERY],
    ['DASHBOARD_QUERY', DASHBOARD_QUERY],
  ])('%s no longer keys on the class proxy', (_name, q) => {
    // The defect, named so it cannot come back as a "widening": class was only
    // ever standing in for ownership.
    expect(q).not.toMatch(/memoryClasses/);
  });

  it('the dashboard fallback COUNT asks the same slice as the list', () => {
    // Scoped to what this assertion actually keeps true, which is narrower than
    // it first looks: DASHBOARD_QUERY's count is only the loader's FALLBACK,
    // used when the server's dashboardWidgetData has no memory-stats entry. On
    // a normal account it does, so the number a user SEES is not this one.
    //
    // Measured when this landed: the widget rendered 87 against a list of 4,
    // because the server's MEMORY_STATS provider calls memories() unfiltered.
    // So the stat was not under-reporting by the two rows the list was missing
    // — it was over-reporting by an order of magnitude, and that is
    // hadron-server's to fix.
    //
    // What this pins is only that the fallback cannot drift from the list it
    // stands in for.
    expect(asksOwnedByMe(DASHBOARD_QUERY)).toBe(asksOwnedByMe(PERSONAL_MEMORIES_QUERY));
  });

  it('the SHARED slice is untouched — it is a different question', () => {
    expect(SHARED_MEMORIES_QUERY).toMatch(/sharedWithMe:\s*true/);
    expect(asksOwnedByMe(SHARED_MEMORIES_QUERY)).toBe(false);
  });
});
