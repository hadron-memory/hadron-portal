/**
 * Tests for GET /app/u/resolve — the JSON sibling of the /app/u/[urn]
 * redirect route. Mirrors page.server.test.ts's strategy (mock gqlClient,
 * hand-rolled event) and its ClientError cases: only KNOWN GraphQL rejection
 * codes map to 4xx; internal/unknown codes and payload-less transport
 * ClientErrors are 500s, so the CommandBar's candidate probing can't mistake
 * a resolver outage for "this candidate doesn't resolve"
 * (review:clienterror-map-known-codes-only, #614/#567).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';

const mockRequest = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: (...args: unknown[]) => mockRequest(...args) }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importGet() {
  const mod = await import('./+server');
  return mod.GET;
}

function ev(urn: string | null, token: string | null = 'tok') {
  const url = new URL(`http://portal.test/app/u/resolve${urn === null ? '' : `?urn=${encodeURIComponent(urn)}`}`);
  return { url, locals: { token } } as unknown as Parameters<Awaited<ReturnType<typeof importGet>>>[0];
}

async function call(urn: string | null, token: string | null = 'tok') {
  const GET = await importGet();
  const res = await GET(ev(urn, token));
  return { status: res.status, body: await res.json() };
}

function clientError(code?: string): ClientError {
  // graphql-request types the response with full GraphQLError objects and
  // fetch metadata; the runtime only carries the serialized shape.
  const response = {
    errors: [{ message: 'rejected', extensions: code ? { code } : {} }],
    status: 200,
  } as unknown as ClientError['response'];
  return new ClientError(response, { query: 'query', variables: {} });
}

describe('/app/u/resolve — request validation', () => {
  it('401s without a token', async () => {
    const r = await call('hrn:org:acme', null);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('UNAUTHENTICATED');
  });

  it('400s without a urn param', async () => {
    const r = await call(null);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('INVALID_INPUT');
  });
});

describe('/app/u/resolve — resolutions', () => {
  it('returns the resolution as JSON', async () => {
    const resolution = { kind: 'org', id: 'org-1', memoryId: null, organizationId: null };
    mockRequest.mockResolvedValueOnce({ resolveUrn: resolution });
    const r = await call('hrn:org:acme');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ resolution });
  });

  it('returns null for an unresolvable / no-access URN', async () => {
    mockRequest.mockResolvedValueOnce({ resolveUrn: null });
    const r = await call('hrn:org:ghost');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ resolution: null });
  });
});

describe('/app/u/resolve — known GraphQL rejection codes map to 4xx', () => {
  it('400s on validation codes', async () => {
    for (const code of ['BAD_USER_INPUT', 'GRAPHQL_VALIDATION_FAILED']) {
      mockRequest.mockRejectedValueOnce(clientError(code));
      const r = await call('garbage');
      expect(r.status).toBe(400);
      expect(r.body.code).toBe(code);
    }
  });

  it('401s on expired/missing-auth codes', async () => {
    for (const code of ['UNAUTHENTICATED', 'SESSION_EXPIRED']) {
      mockRequest.mockRejectedValueOnce(clientError(code));
      const r = await call('hrn:org:acme');
      expect(r.status).toBe(401);
      expect(r.body.code).toBe(code);
    }
  });

  it('404s (existence-hiding) on no-access / not-found codes', async () => {
    for (const code of ['NOT_FOUND', 'NODE_NOT_FOUND', 'FORBIDDEN', 'PERMISSION_DENIED']) {
      mockRequest.mockRejectedValueOnce(clientError(code));
      const r = await call('hrn:memory:acme::secret');
      expect(r.status).toBe(404);
      expect(r.body.code).toBe(code);
    }
  });
});

describe('/app/u/resolve — everything else stays a 500', () => {
  it('500s on an internal/unknown GraphQL error code', async () => {
    for (const code of ['INTERNAL_SERVER_ERROR', undefined]) {
      mockRequest.mockRejectedValueOnce(clientError(code));
      const r = await call('hrn:org:acme');
      expect(r.status).toBe(500);
      expect(r.body.code).toBe('INTERNAL');
    }
  });

  it('500s on a ClientError with no GraphQL errors payload (transport failure)', async () => {
    const response = { status: 502 } as unknown as ClientError['response'];
    mockRequest.mockRejectedValueOnce(new ClientError(response, { query: 'query', variables: {} }));
    const r = await call('hrn:org:acme');
    expect(r.status).toBe(500);
    expect(r.body.code).toBe('INTERNAL');
  });

  it('500s on a non-GraphQL failure', async () => {
    mockRequest.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const r = await call('hrn:org:acme');
    expect(r.status).toBe(500);
    expect(r.body.code).toBe('INTERNAL');
  });
});
