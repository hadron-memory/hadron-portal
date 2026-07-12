/**
 * #533 — tests for the /app/user/[id] public profile loader. Mocks the
 * server's `user(ref:)` read (via $lib/server/api's gqlClient) and asserts the
 * loader returns the user on a hit, 404s when the server returns null (missing
 * OR no-access — indistinguishable), passes params.id through as `ref`, and
 * does NOT swallow a transient request failure into a false 404.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    const load = await importLoad();
    const result = await load(ev('user-1'));
    expect(result).toEqual({ user });
  });

  it('passes params.id through to the server as `ref`', async () => {
    mockRequest.mockResolvedValueOnce({ user: { id: 'x' } });
    const load = await importLoad();
    await load(ev('hrn:user:alice'));
    expect(mockRequest).toHaveBeenCalledWith(expect.any(String), { ref: 'hrn:user:alice' });
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
