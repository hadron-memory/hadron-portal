/**
 * fetchOwnedAgents / fetchOwnedApps — the "My agents" / "My apps" fetchers.
 *
 * #782: scoping moved SERVER-side (filter.ownedByMe). These assert the queries
 * actually carry that filter — if it were ever dropped, the lists would silently
 * widen to every accessible agent/app (and, for a platform admin, to everything
 * system-wide), which is exactly the regression the server filter exists to
 * prevent. The fetchers now pass rows straight through: no client-side filtering.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOwnedAgents } from './personal-agents';
import { fetchOwnedApps } from './personal-apps';
import { MY_AGENTS_QUERY, MY_APPS_QUERY } from './queries';

const mockFetchAll = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: vi.fn() }) }));
vi.mock('$lib/server/paginate', () => ({ fetchAllItems: (...a: unknown[]) => mockFetchAll(...a) }));

beforeEach(() => {
  mockFetchAll.mockReset();
});

describe('MY_AGENTS_QUERY / MY_APPS_QUERY', () => {
  it('scope server-side with filter.ownedByMe', () => {
    expect(MY_AGENTS_QUERY).toMatch(/agents\(\s*filter:\s*\{\s*ownedByMe:\s*true\s*\}/);
    expect(MY_APPS_QUERY).toMatch(/apps\(\s*filter:\s*\{\s*ownedByMe:\s*true\s*\}/);
  });
});

describe('fetchOwnedAgents', () => {
  it('uses the my-agents query and returns the server-scoped rows as-is', async () => {
    const rows = [{ id: 'a1', organizationId: null }];
    mockFetchAll.mockResolvedValue(rows);
    expect(await fetchOwnedAgents('t')).toEqual(rows);
    expect(mockFetchAll.mock.calls[0][1]).toBe(MY_AGENTS_QUERY);
  });
});

describe('fetchOwnedApps', () => {
  it('uses the my-apps query and returns the server-scoped rows as-is', async () => {
    const rows = [{ id: 'p1', organizationId: null }];
    mockFetchAll.mockResolvedValue(rows);
    expect(await fetchOwnedApps('t')).toEqual(rows);
    expect(mockFetchAll.mock.calls[0][1]).toBe(MY_APPS_QUERY);
  });
});
