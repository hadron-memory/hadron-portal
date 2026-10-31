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

  it('resolves the decoded form of an encoded chat-wikilink URN (#1512)', async () => {
    // SvelteKit hands the loader the DECODED param; the chat href carries it as
    // one encoded segment (`..%2F..%2F`), so the resolver sees the original URN.
    const urn = 'hrn:node:a.com:m:../../../settings/tokens';
    mockRequest.mockResolvedValueOnce({
      resolveUrn: { kind: 'node', id: 'n1', memoryId: 'm1', organizationId: null },
    });
    const r = await expectRedirect(urn);
    expect(r.status).toBe(307);
    expect(mockRequest.mock.calls[0][1]).toEqual({ urn });
  });

  it('keeps the signin redirect inside /app/u/ for a URN containing a slash (#1512)', async () => {
    mockRequest.mockRejectedValueOnce(
      new ClientError(
        {
          errors: [{ message: 'rejected', extensions: { code: 'UNAUTHENTICATED' } }],
          status: 200,
        } as unknown as ClientError['response'],
        { query: 'query', variables: {} },
      ),
    );
    const r = await expectRedirect('hrn:node:a.com:m:../../../settings/tokens');
    const dest = new URL(`http://localhost${r.location}`).searchParams.get('redirect')!;
    const u = new URL(dest, 'http://localhost/app/team-chat');
    expect(u.pathname.startsWith('/app/u/')).toBe(true);
    expect(u.pathname.slice('/app/u/'.length)).not.toContain('/');
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

// #694 — a bare "not found" cannot distinguish a wrong-grammar link from a
// deleted node from a typo, and those want different reactions. The hint is
// computed from the INPUT STRING only, never from the resolution — so a
// no-access URN and a nonexistent one still produce byte-identical messages
// (hrn:node:hadronmemory.com:specs:cor:urn:030:02).
describe('/app/u/[urn] — an unresolved URN explains itself by input shape', () => {
  /** Run load against a null resolution and return the thrown error's message. */
  async function messageFor(urn: string): Promise<string> {
    mockRequest.mockResolvedValueOnce({ resolveUrn: null });
    const load = await importLoad();
    try {
      await load(ev(urn));
    } catch (e) {
      return (e as { body?: { message?: string } }).body?.message ?? String(e);
    }
    throw new Error('Expected load to throw');
  }

  it('names the missing hrn:<type>: prefix on a bare URN', async () => {
    const msg = await messageFor('hadronmemory.com::hadron-portal::review');
    expect(msg).toContain('has no "hrn:<type>:" prefix');
    expect(msg).toContain('hrn:node:<org>:<memory>:<loc>');
    // It must NOT claim the spelling is fine — that is the other branch.
    expect(msg).not.toContain('Possible causes:');
  });

  // @codex on #764, round 6. The mixed-separator advice was node-shaped
  // (`hrn:node:<org>:<memory>:<loc>`) on a route serving seven kinds — handed
  // to a reader holding `hrn:user:alice::extra`, whose kind has no hierarchy at
  // all. The same defect was fixed in the fallback a round earlier and left
  // standing in this sibling branch.
  //
  // Note: @codex's first example, `hrn:user:alice::extra`, does NOT reach this
  // branch — `alice` precedes the first `::` and contains no `:`, so it reads
  // as clean legacy. A one-atom kind like `hrn:user:<handle>` cannot be mixed
  // in any plausible way. The concern was right, one of the two examples was
  // not, so the cases below are kinds that genuinely do reach it.
  it('keeps the mixed-separator advice kind-agnostic', async () => {
    for (const urn of [
      'hrn:app:acme.com:docs::extra',
      'hrn:worker:acme.com:team::gil',
      'hrn:mem:acme.com:dev::x',
    ]) {
      const msg = await messageFor(urn);
      expect(msg, urn).toContain('uses both the ":" and "::" separators');
      expect(msg, urn).toContain('Use one style throughout');
      // Must not illustrate one kind's arity at another kind's reader.
      expect(msg, urn).not.toContain('hrn:node:<org>:<memory>:<loc>');
      expect(msg, urn).not.toContain('<memory>');
    }
  });

  it('names a spelling that uses both ":" and "::"', async () => {
    const msg = await messageFor('hrn:node:hadronmemory.com:hadron-portal::review');
    expect(msg).toContain('uses both the ":" and "::" separators');
  });

  it('the well-formed fallback asserts nothing about the URN', async () => {
    // Both accepted grammars reach this branch, as do spellings the checks
    // never examine. So it enumerates causes and excludes none — the only
    // form four rounds of counterexamples could not falsify.
    for (const urn of [
      'hrn:node:hadronmemory.com:hadron-portal:review',
      'hrn:node:hadronmemory.com::hadron-portal::review',
    ]) {
      const msg = await messageFor(urn);
      expect(msg, urn).toContain('Possible causes:');
      expect(msg, urn).toContain('or you do not have access to it');
    }
  });

  // @codex on #764, FOURTH round, and the reason the fallback now claims
  // nothing at all. `acme.com::dev:review` uses v1 between org and memory and
  // v2 before the loc — a genuine mixed spelling that the hierarchy check never
  // sees, because it only inspects the text BEFORE the first '::'. Any message
  // asserting "this is not the separator problem" is false for this input, and
  // detecting it needs per-type arity, i.e. parsing, which this route must not
  // do. So the fallback enumerates possible causes and excludes none.
  it('makes no claim the input cannot support — mixing AFTER the first "::"', async () => {
    const msg = await messageFor('hrn:node:acme.com::dev:review');
    expect(msg).toContain('Possible causes:');
    // The negative claims that four rounds falsified, none of which may return.
    expect(msg).not.toContain('the spelling is not the problem');
    expect(msg).not.toContain('grammar is fine');
    expect(msg).not.toContain('is not the ":" versus "::"');
  });

  it('lists every cause as possible and rules none out', async () => {
    const msg = await messageFor('hrn:node:acme.com:dev:missing');
    for (const cause of ['typo', 'deleted or renamed', 'not visible to you', 'does not resolve']) {
      expect(msg, cause).toContain(cause);
    }
  });

  // @codex on #764, third round — two findings, one root cause: the sentence
  // claimed more than the checks establish.
  it('claims only the prefix and separators, never full grammar validity', async () => {
    // Both reach the fallback with a type-SHAPED prefix and consistent
    // separators, and both are invalid in ways this helper does not check —
    // an unknown type word, and wrong arity. Saying "its grammar is fine"
    // about either was a heuristic promoted into a guarantee.
    for (const urn of ['hrn:bogus:x', 'hrn:user:alice:extra']) {
      const msg = await messageFor(urn);
      expect(msg, urn).toContain('Possible causes:');
      expect(msg, urn).not.toMatch(/grammar is fine|is not the/);
    }
  });

  it('gives kind-agnostic typo advice — this route resolves seven kinds', async () => {
    // "a typo in the org, memory or loc" is node-shaped, and a user URN is
    // `hrn:user:<handle>` with none of those parts. App, worker and org URNs
    // differ again, so the advice must name the identifier, not its components.
    const msg = await messageFor('hrn:user:missing-person');
    expect(msg).toContain('typo');
    for (const nodeShaped of ['the org, memory or loc', 'memory or loc']) {
      expect(msg, nodeShaped).not.toContain(nodeShaped);
    }
  });

  // @codex on #764, second round. Shape can only establish that the separators
  // and prefix are plausible — never that the org, memory slug or loc are
  // spelled right. `hadron-prtal` below is well-formed AND a typo, so a message
  // claiming "the spelling is not the problem" steers that reader away from the
  // one thing they should check. Rule out the GRAMMAR; leave the rest open.
  it('keeps a typo on the table for a well-shaped URN', async () => {
    const msg = await messageFor('hrn:node:hadronmemory.com:hadron-prtal:review');
    expect(msg).toContain('Possible causes:');
    expect(msg).toContain('typo');
    // All three remaining causes stay live — none is ruled out by shape.
    expect(msg).toContain('deleted');
    expect(msg).toContain('not visible to you');
    expect(msg).not.toContain('the spelling is not the problem');
  });

  // bare-loc-ok — a loc shape being described, not a citation.
  // @codex on #764. A legacy loc routinely contains ':' (`findings:foo`) while
  // only the HIERARCHY uses '::'. Scanning the whole body for a lone colon
  // flagged a perfectly valid legacy URN as "mixed" and sent the reader off to
  // fix a spelling that was already right — worse than the bare message it
  // replaced. My original tests could not catch this: the legacy URN I checked
  // by hand had a colon-free loc (`review`), and the one WITH a colon resolved,
  // so the false positive needed both halves at once to appear.
  it('does NOT call a valid legacy URN "mixed" just because its loc contains a colon', async () => {
    for (const urn of [
      'hrn:node:acme.com::dev::findings:foo',
      'urn:node:acme.com::dev::findings:foo',
      'hrn:node:acme.com::dev::a:b:c:d',
      // An ownership chain — >2 atoms, no string-derivable v2 form. Its first
      // atom is still the root, so it must read as clean legacy too.
      'hrn:node:micromentor.org::coding-app::coding-agent::system::review:sort-imports',
    ]) {
      const msg = await messageFor(urn);
      expect(msg, urn).not.toContain('uses both the');
      expect(msg, urn).toContain('Possible causes:');
    }
  });

  it('reports a URN that uses BOTH separators — v2-joined hierarchy, then "::"', async () => {
    const msg = await messageFor('hrn:node:acme.com:dev::findings:foo');
    expect(msg).toContain('uses both the ":" and "::" separators');
  });

  // @copilot on #764 — the type word may contain hyphens.
  it('recognises a hyphenated type word as a prefix', async () => {
    for (const urn of ['hrn:chat-message:acme.com:dev:x', 'hrn:ai-config:acme.com:cfg']) {
      const msg = await messageFor(urn);
      expect(msg, urn).not.toContain('has no "hrn:<type>:" prefix');
    }
  });

  it('does not disclose existence — the message depends only on the input', async () => {
    // The same URN must read identically whether the server declined it as
    // absent (null resolution) or as forbidden (FORBIDDEN rejection). If these
    // ever diverge, the route has started leaking whether the resource exists.
    const urn = 'hrn:node:hadronmemory.com:hadron-portal:secret';
    const whenNull = await messageFor(urn);

    mockRequest.mockRejectedValueOnce(
      new ClientError(
        { errors: [{ message: 'x', extensions: { code: 'FORBIDDEN' } }], status: 200 } as unknown as ClientError['response'],
        { query: 'query', variables: {} },
      ),
    );
    const load = await importLoad();
    let whenForbidden = '';
    try {
      await load(ev(urn));
    } catch (e) {
      whenForbidden = (e as { body?: { message?: string } }).body?.message ?? '';
    }
    expect(whenForbidden).toBe(whenNull);
  });

  it('adds the shape hint to the 400 without repeating the well-formed line', async () => {
    mockRequest.mockRejectedValueOnce(
      new ClientError(
        { errors: [{ message: 'x', extensions: { code: 'BAD_USER_INPUT' } }], status: 200 } as unknown as ClientError['response'],
        { query: 'query', variables: {} },
      ),
    );
    const load = await importLoad();
    let msg = '';
    try {
      await load(ev('total-garbage'));
    } catch (e) {
      msg = (e as { body?: { message?: string } }).body?.message ?? '';
    }
    expect(msg).toContain('is not a valid Hadron URN.');
    expect(msg).toContain('has no "hrn:<type>:" prefix');
    // The server already said it is malformed; "no resource found" would
    // contradict that in the same sentence.
    expect(msg).not.toContain('No resource found');
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

// portal#1099 — `resolveUrn` doesn't resolve ticker URNs yet (hrn:node:hadronmemory.com:specs:cor:agt:080:01),
// so the route asks `ticker(ref:)`, which runs the ticker's own read gate.
describe('hrn:ticker: URNs (portal#1099)', () => {
  const urn = 'hrn:ticker:acme.com:team:engineering';

  it('redirects to the ticker page in its App, 307, keeping the query', async () => {
    const { TICKER_QUERY } = await import('$lib/server/tickers');
    mockRequest.mockResolvedValueOnce({ ticker: { id: 'tk-1', app: { id: 'app-1' } } });
    const load = await importLoad();
    await expect(load(ev(urn, '?after=s1') as never)).rejects.toMatchObject({ status: 307, location: '/app/apps/app-1/tickers/tk-1?after=s1' });
    expect(mockRequest).toHaveBeenCalledWith(TICKER_QUERY, { ref: urn });
  });

  it('a missing or unreachable ticker (null for both) is the same no-oracle 404', async () => {
    mockRequest.mockResolvedValueOnce({ ticker: null });
    const load = await importLoad();
    await expect(load(ev(urn) as never)).rejects.toMatchObject({ status: 404 });
  });

  // #1209: Ticker.app becomes nullable (null when the reader can't read the
  // App directly). For the resolver that is the ordinary not-found — the same
  // 404 as a missing ticker, never a redirect to /app/apps/null/....
  it('a ticker whose App the reader cannot read (app null) is the same no-oracle 404 (#1209)', async () => {
    mockRequest.mockResolvedValueOnce({ ticker: { id: 'tk-1', app: null } });
    const load = await importLoad();
    await expect(load(ev(urn) as never)).rejects.toMatchObject({ status: 404 });
  });

  it('never asks resolveUrn for a ticker', async () => {
    const { RESOLVE_URN_QUERY } = await import('$lib/server/queries');
    mockRequest.mockResolvedValueOnce({ ticker: null });
    const load = await importLoad();
    await Promise.resolve(load(ev(urn) as never)).catch(() => {});
    expect(mockRequest).not.toHaveBeenCalledWith(RESOLVE_URN_QUERY, expect.anything());
  });
});

// #1213: provider refusals must use the same mapping for ticker deep links.
describe('ticker URN provider-error mapping (#1213)', () => {
  const urn = 'hrn:ticker:acme.com:team:engineering';
  function rejection(code?: string) {
    return new ClientError({
      status: 200,
      errors: [{ message: 'provider detail must not become the page message', extensions: code ? { code } : {} }],
    } as unknown as ClientError['response'], { query: 'query', variables: {} });
  }

  it.each(['BAD_USER_INPUT', 'GRAPHQL_VALIDATION_FAILED'])('maps %s to input 400', async (code) => {
    mockRequest.mockRejectedValueOnce(rejection(code));
    const load = await importLoad();
    await expect(load(ev(urn))).rejects.toMatchObject({ status: 400, body: { message: expect.stringContaining('is not a valid Hadron URN') } });
  });

  it.each(['UNAUTHENTICATED', 'SESSION_EXPIRED'])('maps %s to signin with the whole deep link', async (code) => {
    mockRequest.mockRejectedValueOnce(rejection(code));
    const load = await importLoad();
    await expect(load(ev(urn, '?after=s1&tab=subscribers'))).rejects.toMatchObject({
      status: 303,
      location: `/signin?redirect=${encodeURIComponent(`/app/u/${urn}?after=s1&tab=subscribers`)}`,
    });
  });

  it.each(['NOT_FOUND', 'NODE_NOT_FOUND', 'FORBIDDEN', 'PERMISSION_DENIED'])('maps %s identically to a null ticker or withheld App', async (code) => {
    const load = await importLoad();
    mockRequest.mockResolvedValueOnce({ ticker: null });
    const absent = await expectError(urn) as { status: number; body: { message: string } };
    mockRequest.mockResolvedValueOnce({ ticker: { id: 'tk-1', app: null } });
    await expect(load(ev(urn))).rejects.toMatchObject({ status: absent.status, body: absent.body });
    mockRequest.mockRejectedValueOnce(rejection(code));
    await expect(load(ev(urn))).rejects.toMatchObject({ status: absent.status, body: absent.body });
  });

  it.each(['INTERNAL_SERVER_ERROR', 'UNRECOGNIZED', undefined])('preserves unknown/internal code %s', async (code) => {
    const failure = rejection(code);
    mockRequest.mockRejectedValueOnce(failure);
    const load = await importLoad();
    await expect(load(ev(urn))).rejects.toBe(failure);
  });

  it('preserves payload-less transport and non-GraphQL failures', async () => {
    const load = await importLoad();
    for (const failure of [
      new ClientError({ status: 502 } as ClientError['response'], { query: 'query', variables: {} }),
      new Error('synthetic transport failure'),
    ]) {
      mockRequest.mockRejectedValueOnce(failure);
      await expect(load(ev(urn))).rejects.toBe(failure);
    }
  });
});
