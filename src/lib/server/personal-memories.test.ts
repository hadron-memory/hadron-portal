/**
 * fetchOwnedMemories / fetchSharedMemories — the two memory fetchers behind the
 * tabbed /app/memories page. Owned keeps only org-less (user-owned) rows; shared
 * (#778) lists grantee memories via the sharedWithMe query.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOwnedMemories, fetchSharedMemories } from './personal-memories';
import { PERSONAL_MEMORIES_QUERY, SHARED_MEMORIES_QUERY } from './queries';

const mockFetchAll = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: vi.fn() }) }));
vi.mock('$lib/server/paginate', () => ({ fetchAllItems: (...a: unknown[]) => mockFetchAll(...a) }));

beforeEach(() => mockFetchAll.mockReset());

describe('fetchOwnedMemories', () => {
  it('keeps only org-less (user-owned) memories, dropping org-owned ones', async () => {
    mockFetchAll.mockResolvedValue([
      { id: 'a', organizationId: null },
      { id: 'b', organizationId: 'org-9' },
    ]);
    expect(await fetchOwnedMemories('t')).toEqual([{ id: 'a', organizationId: null }]);
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
