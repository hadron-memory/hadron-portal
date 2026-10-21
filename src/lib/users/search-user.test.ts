import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchUsersPage } from './search-user';

const u = (id: string) => ({ id, handle: id, urn: null, githubUsername: null, avatarUrl: null, emailMasked: null });

function respond(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })));
}
afterEach(() => vi.unstubAllGlobals());

describe('searchUsersPage (#1226)', () => {
  it('is truncated when the server holds more matches than it returned', async () => {
    respond({ users: [u('a'), u('b')], total: 30 });
    expect(await searchUsersPage('abc')).toEqual({ users: [u('a'), u('b')], truncated: true });
  });

  it('is complete when total equals the returned rows', async () => {
    respond({ users: [u('a')], total: 1 });
    expect((await searchUsersPage('abc')).truncated).toBe(false);
  });

  it('hiding existing members never reads as "no more matches"', async () => {
    respond({ users: [u('a'), u('b')], total: 2 });
    const page = await searchUsersPage('abc', new Set(['a', 'b']));
    expect(page).toEqual({ users: [], truncated: false });
    respond({ users: [u('a'), u('b')], total: 25 });
    expect((await searchUsersPage('abc', new Set(['a', 'b']))).truncated).toBe(true);
  });

  it('throws on a failed search', async () => {
    respond({}, false);
    await expect(searchUsersPage('abc')).rejects.toThrow('Search failed');
  });
});
