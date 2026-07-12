/**
 * #262 — tests for the /app/u/[urn] URN resolver route. Mocks the server's
 * `resolveUrn` query (via $lib/server/api's gqlClient) and asserts the route
 * turns each kind's resolution into the right 307 redirect, and a null
 * resolution into a 404.
 *
 * Strategy mirrors layout.server.test.ts: mock gqlClient, import `load`,
 * call it with a hand-rolled event, and catch the thrown redirect/error.
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

function ev(urn: string) {
  return {
    params: { urn },
    locals: { user: { id: 'u1', roles: ['user'], githubUsername: 'gh' }, token: 'tok' },
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

/** Run load and capture the thrown redirect (SvelteKit's redirect() throws). */
async function expectRedirect(urn: string): Promise<{ status: number; location: string }> {
  const load = await importLoad();
  try {
    await load(ev(urn));
  } catch (e) {
    return e as { status: number; location: string };
  }
  throw new Error('Expected load to throw a redirect, but it returned normally');
}

async function expectError(urn: string): Promise<{ status: number }> {
  const load = await importLoad();
  try {
    await load(ev(urn));
  } catch (e) {
    return e as { status: number };
  }
  throw new Error('Expected load to throw an error, but it returned normally');
}

describe('/app/u/[urn] — redirects each kind to its canonical page', () => {
  it('redirects a memory URN to /app/memories/{id} (307)', async () => {
    mockRequest.mockResolvedValueOnce({
      resolveUrn: { kind: 'memory', id: 'mem-1', memoryId: null, organizationId: null },
    });
    const r = await expectRedirect('urn:memory:acme.com::dev');
    expect(r.status).toBe(307);
    expect(r.location).toBe('/app/memories/mem-1');
  });

  it('redirects a node URN to /app/memories/{memoryId}/nodes/{id}', async () => {
    mockRequest.mockResolvedValueOnce({
      resolveUrn: { kind: 'node', id: 'node-1', memoryId: 'mem-9', organizationId: null },
    });
    const r = await expectRedirect('urn:node:acme.com::dev::findings:foo');
    expect(r.status).toBe(307);
    expect(r.location).toBe('/app/memories/mem-9/nodes/node-1');
  });

  it('redirects an org URN to /app/orgs/{id}', async () => {
    mockRequest.mockResolvedValueOnce({
      resolveUrn: { kind: 'org', id: 'org-1', memoryId: null, organizationId: null },
    });
    const r = await expectRedirect('urn:org:acme.com');
    expect(r.location).toBe('/app/orgs/org-1');
  });

  it('redirects an agent URN to /app/agents/{id}', async () => {
    mockRequest.mockResolvedValueOnce({
      resolveUrn: { kind: 'agent', id: 'agent-1', memoryId: null, organizationId: null },
    });
    const r = await expectRedirect('urn:agent:acme.com:bot');
    expect(r.location).toBe('/app/agents/agent-1');
  });

  it('redirects a user URN to /app/user/{id}', async () => {
    mockRequest.mockResolvedValueOnce({
      resolveUrn: { kind: 'user', id: 'user-1', memoryId: null, organizationId: null },
    });
    const r = await expectRedirect('urn:user:alice');
    expect(r.status).toBe(307);
    expect(r.location).toBe('/app/user/user-1');
  });

  it('redirects an app URN to /app/orgs/{organizationId}/apps/{id}', async () => {
    mockRequest.mockResolvedValueOnce({
      resolveUrn: { kind: 'app', id: 'app-1', memoryId: null, organizationId: 'org-7' },
    });
    const r = await expectRedirect('urn:app:acme.com:bot-app');
    expect(r.location).toBe('/app/orgs/org-7/apps/app-1');
  });
});

describe('/app/u/[urn] — unresolvable and inaccessible URNs 404', () => {
  it('404s when the server resolves null (not-found OR no-access)', async () => {
    mockRequest.mockResolvedValueOnce({ resolveUrn: null });
    const r = await expectError('urn:memory:acme.com::nope');
    expect(r.status).toBe(404);
  });

  it('500s (not a broken redirect) when a node resolves without a memoryId', async () => {
    // A known kind missing its required parent id is an incomplete/malformed
    // resolution, distinct from a clean not-found — surfaced as 500, not 404.
    mockRequest.mockResolvedValueOnce({
      resolveUrn: { kind: 'node', id: 'node-1', memoryId: null, organizationId: null },
    });
    const r = await expectError('urn:node:acme.com::dev::x');
    expect(r.status).toBe(500);
  });

  it('passes the URN through to the server verbatim (trimmed)', async () => {
    mockRequest.mockResolvedValueOnce({
      resolveUrn: { kind: 'memory', id: 'mem-1', memoryId: null, organizationId: null },
    });
    await expectRedirect('  urn:memory:acme.com::dev  ');
    expect(mockRequest).toHaveBeenCalledWith(expect.any(String), { urn: 'urn:memory:acme.com::dev' });
  });
});
