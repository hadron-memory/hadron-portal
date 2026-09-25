/**
 * #533 — tests for the /app/user/[id] public profile loader. Mocks the
 * server's `user(ref:)` read (via $lib/server/api's gqlClient) and asserts the
 * loader returns the user on a hit, 404s when the server returns null (missing
 * OR no-access — indistinguishable), passes params.id through as `ref`, and
 * does NOT swallow a transient request failure into a false 404.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HELD_WORKERS_QUERY, USER_PROFILE_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: (...args: unknown[]) => mockRequest(...args) }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importLoad() {
  const mod = await import('./+page.server');
  return mod.load;
}

function ev(id: string) {
  return {
    params: { id },
    locals: { user: { id: 'u1', roles: ['user'] }, token: 'tok' },
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

describe('/app/user/[id] loader', () => {
  it('returns the public user on a hit', async () => {
    const user = {
      id: 'user-1',
      handle: 'alice',
      urn: 'hrn:user:alice',
      githubUsername: 'alice-gh',
      avatarUrl: 'https://cdn/a.png',
    };
    mockRequest.mockResolvedValueOnce({ user });
    mockRequest.mockResolvedValueOnce({ heldWorkers: { items: [], total: 0 } });
    const load = await importLoad();
    const result = await load(ev('user-1'));
    expect(result).toEqual({ user, heldWorkers: { ok: true, items: [], total: 0 } });
  });

  it('passes params.id through to the server as `ref`', async () => {
    mockRequest.mockResolvedValueOnce({ user: { id: 'x' } });
    const load = await importLoad();
    await load(ev('hrn:user:alice'));
    expect(mockRequest).toHaveBeenCalledWith(USER_PROFILE_QUERY, { ref: 'hrn:user:alice' });
  });

  it('404s when the server returns null (missing OR no-access)', async () => {
    mockRequest.mockResolvedValueOnce({ user: null });
    const load = await importLoad();
    await expect(load(ev('nope'))).rejects.toMatchObject({ status: 404 });
  });

  it('does NOT swallow a transient request failure into a 404', async () => {
    mockRequest.mockRejectedValueOnce(new Error('network blip'));
    const load = await importLoad();
    // The rejection propagates (SvelteKit turns it into a 500), never a 404.
    await expect(load(ev('user-1'))).rejects.toThrow('network blip');
  });
});

describe('/app/user/[id] loader — the Workers tab (#919)', () => {
  const user = { id: 'user-1', handle: 'alice', urn: 'hrn:user:alice', githubUsername: null, avatarUrl: null };
  const worker = {
    id: 'w1', name: 'Dara', urn: 'hrn:worker:acme.com:team:dara', role: 'server-engineer',
    appId: 'app-1', appUrn: 'hrn:app:acme.com:team', heldAt: '2026-09-20T10:00:00Z',
    hasLiveSession: true, lastActiveAt: '2026-09-25T10:00:00Z',
  };

  it('asks for the RESOLVED user\'s holds, by id, never by the URL ref', async () => {
    mockRequest.mockResolvedValueOnce({ user });
    mockRequest.mockResolvedValueOnce({ heldWorkers: { items: [worker], total: 1 } });
    const load = await importLoad();
    const result = (await load(ev('hrn:user:alice'))) as { heldWorkers: unknown };
    expect(mockRequest).toHaveBeenCalledWith(HELD_WORKERS_QUERY, { userRef: 'user-1', limit: 200 });
    expect(result.heldWorkers).toEqual({ ok: true, items: [worker], total: 1 });
  });

  it('REPORTS a failed read instead of claiming the user holds nothing, and still renders the profile', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRequest.mockResolvedValueOnce({ user });
    mockRequest.mockRejectedValueOnce(new Error('heldWorkers down'));
    const load = await importLoad();
    const result = (await load(ev('user-1'))) as { user: unknown; heldWorkers: { ok: boolean; detail?: string } };
    expect(result.user).toEqual(user);
    expect(result.heldWorkers.ok).toBe(false);
    expect(result.heldWorkers.detail).toBeTruthy();
  });
});
