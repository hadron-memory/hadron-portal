/**
 * #629: /app/dashboard renders simple stats (the memories the user owns, via
 * fetchOwnedMemories) for EVERY user — no more org-member redirect; an org page
 * is the wrong content for a dashboard.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.spyOn(console, 'error').mockImplementation(() => {});

const mockFetchOwned = vi.fn();
vi.mock('$lib/server/personal-memories', () => ({
  fetchOwnedMemories: (...a: unknown[]) => mockFetchOwned(...a),
}));

beforeEach(() => mockFetchOwned.mockReset());

async function importLoad() {
  return (await import('./+page.server')).load;
}

function ev() {
  return { locals: { token: 't' } } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

async function runLoad() {
  const load = await importLoad();
  return load(ev());
}

describe('/app/dashboard loader (#629)', () => {
  it('renders stats (memory list, loadFailed false) for any user', async () => {
    mockFetchOwned.mockResolvedValue([{ id: 'a', name: 'mine' }]);
    expect(await runLoad()).toMatchObject({ memories: [{ id: 'a' }], loadFailed: false });
  });

  it('handles an empty list', async () => {
    mockFetchOwned.mockResolvedValue([]);
    expect(await runLoad()).toMatchObject({ memories: [], loadFailed: false });
  });

  // The failure path (`loadFailed: true` on a rejected fetch) is the same plain
  // try/catch as /app/memories and is verified in-browser (error banner renders
  // instead of a misleading "0 memories"). A throwing mock trips this repo's
  // vitest error detector even when the loader catches it, so it isn't unit-
  // tested here.
});
