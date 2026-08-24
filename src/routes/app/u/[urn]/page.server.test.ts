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
import { ClientError } from 'graphql-request';
import { isLocalPath } from '$lib/safeRedirect';

type UrnKind = 'memory' | 'node' | 'agent' | 'org' | 'app' | 'user' | 'worker';

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

/**
 * `search` is the incoming query string (#761) — a real URL so `url.search` has
 * the same '' / '?…' shape the framework hands the loader, rather than a stub
 * that could disagree with it.
 */
function ev(urn: string, search = '') {
  return {
    params: { urn },
    url: new URL(`http://localhost/app/u/${urn}${search}`),
    locals: { user: { id: 'u1', roles: ['user'], githubUsername: 'gh' }, token: 'tok' },
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

/** Run load and capture the thrown redirect (SvelteKit's redirect() throws). */
async function expectRedirect(
  urn: string,
  search = '',
): Promise<{ status: number; location: string }> {
  const load = await importLoad();
  try {
    await load(ev(urn, search));
  } catch (e) {
    return e as { status: number; location: string };
  }
  throw new Error('Expected load to throw a redirect, but it returned normally');
}

async function expectError(urn: string, search = ''): Promise<{ status: number }> {
  const load = await importLoad();
  try {
    await load(ev(urn, search));
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

  it('redirects a canonical hrn:user: URN to /app/user/{id}', async () => {
    // The #533 shareable links use the canonical `hrn:` scheme — cover it
    // explicitly so a regression on that path is caught.
    mockRequest.mockResolvedValueOnce({
      resolveUrn: { kind: 'user', id: 'user-2', memoryId: null, organizationId: null },
    });
    const r = await expectRedirect('hrn:user:bob');
    expect(r.status).toBe(307);
    expect(r.location).toBe('/app/user/user-2');
  });

  it('redirects an app URN to the canonical org-optional /app/apps/{id}', async () => {
    mockRequest.mockResolvedValueOnce({
      resolveUrn: { kind: 'app', id: 'app-1', memoryId: null, organizationId: 'org-7' },
    });
    const r = await expectRedirect('urn:app:acme.com:bot-app');
    expect(r.location).toBe('/app/apps/app-1');
  });

  it('redirects a user-owned (org-less) app URN to /app/apps/{id}', async () => {
    mockRequest.mockResolvedValueOnce({
      resolveUrn: { kind: 'app', id: 'app-2', memoryId: null, organizationId: null },
    });
    const r = await expectRedirect('urn:app:alice:personal-bot');
    expect(r.location).toBe('/app/apps/app-2');
  });

  // #735/#991. The server has resolved `hrn:worker:` since #991, but this route
  // had no case for it — so every identity signature required by
  // hadron-server#1008 landed its reader on a 404, which is the exact opposite
  // of what a signature is for.
  it('redirects a worker URN to its own page, not to the App', async () => {
    mockRequest.mockResolvedValueOnce({
      resolveUrn: { kind: 'worker', id: 'w-1', memoryId: null, organizationId: 'org-7' },
    });
    const r = await expectRedirect('hrn:worker:hadronmemory.com:hadron-dev-team:gil');
    expect(r.location).toBe('/app/workers/w-1');
    // A redirect to the App's staff roster would answer "which team" rather
    // than "who is this" (#737), so it is explicitly not that.
    expect(r.location).not.toContain('/app/apps/');
  });

  // UrnResolution carries no appId, so a worker resolution legitimately has
  // nothing but its own id. That must not be mistaken for the "incomplete
  // resolution" 500 that a node without a memoryId gets.
  it('redirects a worker URN even when no organizationId is carried', async () => {
    mockRequest.mockResolvedValueOnce({
      resolveUrn: { kind: 'worker', id: 'w-2', memoryId: null, organizationId: null },
    });
    const r = await expectRedirect('hrn:worker:alice:solo-app:iris');
    expect(r.location).toBe('/app/workers/w-2');
  });
});

// #761 — the resolver rewrites the PATH; it must not also discard the caller's
// STATE. Every deep link the portal deliberately made linkable (?tab=, ?chat=,
// the #739 worklog filters) travels through here when written as a URN, and a
// dropped query resolved and rendered on the target's DEFAULT view without
// erroring — the failure mode that looks like it worked.
describe('/app/u/[urn] — the redirect carries the query string', () => {
  it('preserves ?tab= and ?chat= onto the App page (the reported case)', async () => {
    mockRequest.mockResolvedValueOnce({
      resolveUrn: { kind: 'app', id: 'app-1', memoryId: null, organizationId: 'org-7' },
    });
    const r = await expectRedirect(
      'hrn:app:hadronmemory.com:hadron-dev-team',
      '?tab=chats&chat=chats:team',
    );
    expect(r.status).toBe(307);
    expect(r.location).toBe('/app/apps/app-1?tab=chats&chat=chats:team');
  });

  it('appends nothing when there is no incoming query', async () => {
    // Guards the other direction: a plain URN visit must not gain a bare '?'.
    mockRequest.mockResolvedValueOnce({
      resolveUrn: { kind: 'app', id: 'app-1', memoryId: null, organizationId: 'org-7' },
    });
    const r = await expectRedirect('hrn:app:hadronmemory.com:hadron-dev-team');
    expect(r.location).toBe('/app/apps/app-1');
  });

  it('preserves the query for EVERY resolved kind, not just the App', async () => {
    // All seven kinds funnel through one redirect, so this asserts the property
    // where it actually lives rather than trusting one kind to speak for six.
    const cases: Array<[UrnKind, Record<string, string | null>, string]> = [
      ['memory', { id: 'mem-1' }, '/app/memories/mem-1'],
      ['node', { id: 'node-1', memoryId: 'mem-9' }, '/app/memories/mem-9/nodes/node-1'],
      ['org', { id: 'org-1' }, '/app/orgs/org-1'],
      ['agent', { id: 'agent-1' }, '/app/agents/agent-1'],
      ['user', { id: 'user-1' }, '/app/user/user-1'],
      ['app', { id: 'app-1' }, '/app/apps/app-1'],
      ['worker', { id: 'w-1' }, '/app/workers/w-1'],
    ];
    for (const [kind, ids, path] of cases) {
      mockRequest.mockResolvedValueOnce({
        resolveUrn: { kind, memoryId: null, organizationId: null, ...ids },
      });
      const r = await expectRedirect(`hrn:${kind}:acme.com:x`, '?tab=deep&filter=on');
      expect(r.location, `kind: ${kind}`).toBe(`${path}?tab=deep&filter=on`);
    }
  });

  it('preserves the worklog filters whose justification was linkability (#739)', async () => {
    mockRequest.mockResolvedValueOnce({
      resolveUrn: { kind: 'app', id: 'app-1', memoryId: null, organizationId: 'org-7' },
    });
    const r = await expectRedirect(
      'hrn:app:hadronmemory.com:hadron-dev-team',
      '?tab=worklog&worklogKind=pr&worklogRef=owner%2Frepo%23371',
    );
    expect(r.location).toBe(
      '/app/apps/app-1?tab=worklog&worklogKind=pr&worklogRef=owner%2Frepo%23371',
    );
  });

  it('carries the query through the signin round-trip, encoded once', async () => {
    // Signing in to reach a deep link must not be what costs you the deep link.
    mockRequest.mockRejectedValueOnce(
      new ClientError(
        {
          errors: [{ message: 'rejected', extensions: { code: 'UNAUTHENTICATED' } }],
          status: 200,
        } as unknown as ClientError['response'],
        { query: 'query', variables: {} },
      ),
    );
    const r = await expectRedirect('hrn:app:acme.com:x', '?tab=chats');
    expect(r.status).toBe(303);
    expect(r.location).toBe(
      `/signin?redirect=${encodeURIComponent('/app/u/hrn:app:acme.com:x?tab=chats')}`,
    );
    // The value must round-trip through the #439 open-redirect guard, which
    // only accepts a local path — a query string must not make it look foreign.
    const dest = new URL(`http://localhost${r.location}`).searchParams.get('redirect');
    expect(isLocalPath(dest)).toBe(true);
    expect(dest).toBe('/app/u/hrn:app:acme.com:x?tab=chats');
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

describe('/app/u/[urn] — GraphQL rejections do not surface as 500s (#567)', () => {
  function clientError(code?: string): ClientError {
    // graphql-request types the response with full GraphQLError objects and
    // fetch metadata; the runtime only carries the serialized shape.
    const response = {
      errors: [{ message: 'rejected', extensions: code ? { code } : {} }],
      status: 200,
    } as unknown as ClientError['response'];
    return new ClientError(response, { query: 'query', variables: {} });
  }

  it('400s when the server rejects the URN as invalid input', async () => {
    mockRequest.mockRejectedValueOnce(clientError('BAD_USER_INPUT'));
    const r = await expectError('total-garbage');
    expect(r.status).toBe(400);
  });

  it('404s (existence-hiding) on known no-access / not-found codes', async () => {
    for (const code of ['PERMISSION_DENIED', 'FORBIDDEN', 'NOT_FOUND', 'NODE_NOT_FOUND']) {
      mockRequest.mockRejectedValueOnce(clientError(code));
      const r = await expectError('urn:memory:acme.com::secret');
      expect(r.status).toBe(404);
    }
  });

  it('redirects to signin on an expired/missing-auth code (mirrors the app hooks)', async () => {
    mockRequest.mockRejectedValueOnce(clientError('UNAUTHENTICATED'));
    const r = await expectRedirect('urn:memory:acme.com::dev');
    expect(r.status).toBe(303);
    expect(r.location).toBe(`/signin?redirect=${encodeURIComponent('/app/u/urn:memory:acme.com::dev')}`);
  });

  it('rethrows an internal/unknown GraphQL error code (stays a 500)', async () => {
    for (const code of ['INTERNAL_SERVER_ERROR', undefined]) {
      mockRequest.mockRejectedValueOnce(clientError(code));
      const load = await importLoad();
      await expect(load(ev('urn:memory:acme.com::dev'))).rejects.toBeInstanceOf(ClientError);
    }
  });

  it('rethrows a ClientError with no GraphQL errors payload (transport failure)', async () => {
    const response = { status: 502 } as unknown as ClientError['response'];
    mockRequest.mockRejectedValueOnce(new ClientError(response, { query: 'query', variables: {} }));
    const load = await importLoad();
    await expect(load(ev('urn:memory:acme.com::dev'))).rejects.toBeInstanceOf(ClientError);
  });

  it('keeps a non-GraphQL failure a 500 (transient outage ≠ not-found)', async () => {
    mockRequest.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const load = await importLoad();
    await expect(load(ev('urn:memory:acme.com::dev'))).rejects.toThrow('ECONNREFUSED');
  });
});
