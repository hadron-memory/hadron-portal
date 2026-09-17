/**
 * Tests for the org-detail layout loader (#336). The layout loads the org once
 * for the header/tabs; this is where the missing-org 404 lives now (the Profile
 * and Integrations page loaders pull the org from parent()).
 *
 * #843: the loader no longer coerces every rejection to 404. Since #842 the
 * memories, agents and apps loaders read this layout's org via parent() rather
 * than fetching their own, so this one catch is the error behaviour of the
 * whole org surface — an outage rendering as "Organization not found" is a
 * confident false statement on every tab, not just this one.
 *
 * The cases below are pinned in BOTH directions on purpose. A rejection whose
 * code is in the allowlist must 404 and one whose code is not must come back
 * out untouched, using the SAME fake-error builder: if that builder produced a
 * shape `extractGqlErrorCode` could not read, every code would look like null
 * and the 404 cases would fail while the rethrow cases still passed. One
 * direction alone would ratify a broken fixture.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_CHROME_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importLoad() {
  const mod = await import('./+layout.server');
  return mod.load;
}

function ev(opts: { orgId?: string } = {}) {
  return {
    params: { id: opts.orgId ?? 'org-id-123' },
    locals: { token: 'test-token' },
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

// The chrome slice, and ONLY that — a fixture carrying `members` here would
// quietly ratify a layout that still selects it (#845).
const fakeOrg = { id: 'org-id-123', name: 'Acme', urn: 'urn:org:acme' };

/**
 * A graphql-request ClientError as the server actually delivers one: the code
 * lives at `response.errors[0].extensions.code`, which is the only place the
 * loader is allowed to read a classification from.
 */
function gqlError(code: string, message = 'nope') {
  return Object.assign(new Error(`${message}: ${JSON.stringify({ code })}`), {
    response: { errors: [{ message, extensions: { code } }] },
  });
}

/** Run the loader and hand back whatever it threw (or `undefined`). */
async function loadAndCatch() {
  const load = await importLoad();
  try {
    await load(ev({}));
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('org-detail layout load()', () => {
  it('happy path → returns { org } and queries by id', async () => {
    mockRequest.mockResolvedValue({ organization: fakeOrg });
    const load = await importLoad();
    const result = await load(ev({}));
    expect(result).toEqual({ org: fakeOrg });
    // #845: the CHROME query, not ORGANIZATION_QUERY. Asserting the document
    // rather than just "a call happened" is the whole point — the layout must
    // not select a nested list, because a non-null list that fails propagates
    // its null up to `organization` and turns one tab's failure into a 404 over
    // the entire org surface.
    expect(mockRequest).toHaveBeenCalledWith(ORG_CHROME_QUERY, { ref: 'org-id-123' });
  });

  it('organization is null → 404', async () => {
    mockRequest.mockResolvedValue({ organization: null });
    expect((await loadAndCatch() as { status: number }).status).toBe(404);
  });

  describe('a code meaning the ref names no openable org → 404', () => {
    // Each of these is lifted from hadron-server's formatError.ts mapping table.
    // AmbiguousLegacyUrnError is spelled as the CLASS NAME because that is what
    // the server emits — a guessed AMBIGUOUS_LEGACY_URN would match nothing and
    // fall through to a 500 in silence.
    it.each([
      ['ORGANIZATION_NOT_FOUND', 'the ref resolved to no org'],
      ['URN_NOT_QUALIFIED', 'a relative-form URN in the route param'],
      ['BAD_USER_INPUT', 'a malformed URN in the route param'],
    ])('%s → 404 (%s)', async (code) => {
      mockRequest.mockRejectedValue(gqlError(code));
      const thrown = await loadAndCatch();
      expect((thrown as { status: number }).status).toBe(404);
      expect((thrown as { body?: { message?: string } }).body?.message).toBe(
        'Organization not found',
      );
    });

    it('FORBIDDEN → 404, so a refusal does not disclose that the org exists', async () => {
      // Forward-compatible: organization(ref:) cannot emit this yet (see the
      // INTERNAL_SERVER_ERROR case below). Pinned now so the day the server
      // types that refusal, the behaviour it lands on is already asserted and
      // the temporary arm can be deleted without writing a new test.
      mockRequest.mockRejectedValue(gqlError('FORBIDDEN', 'Forbidden'));
      expect((await loadAndCatch() as { status: number }).status).toBe(404);
    });

    it('INTERNAL_SERVER_ERROR → 404, the TEMPORARY arm for the untyped refusal', async () => {
      // hadron-server `resolvers.query.org.ts:446` refuses a non-member with a
      // plain `new Error('Forbidden')`, which Apollo wraps as
      // INTERNAL_SERVER_ERROR — so a permission boundary and a resolver crash
      // share one code and the portal cannot separate them.
      //
      // Keeping the pre-existing 404 is the lesser of the two errors: a 500
      // here would both regress the non-member to an outage page and let a
      // prober tell an org that exists from one that does not. This assertion
      // is expected to be DELETED, not changed, once the refusal carries
      // FORBIDDEN — the case above is where it goes.
      mockRequest.mockRejectedValue(gqlError('INTERNAL_SERVER_ERROR', 'Forbidden'));
      expect((await loadAndCatch() as { status: number }).status).toBe(404);
    });
  });

  describe('anything else propagates → 500, not a false "not found"', () => {
    it('a transport failure with no response at all is rethrown unchanged', async () => {
      // The issue's headline case: the server is unreachable, so graphql-request
      // rejects with a plain Error carrying no GraphQL payload. Nothing here can
      // be a refusal — a refusal is something a working server decided.
      const boom = new Error('fetch failed');
      mockRequest.mockRejectedValue(boom);
      const thrown = await loadAndCatch();
      expect(thrown).toBe(boom);
      expect((thrown as { status?: number }).status).toBeUndefined();
    });

    it('a ClientError with a response but no errors array is rethrown unchanged', async () => {
      // A bad gateway or an HTML error body: `response` exists, `errors` does
      // not, so there is no code to read. Reading one anyway would yield
      // undefined and — under the old blanket catch — a 404.
      const badGateway = Object.assign(new Error('Bad Gateway'), {
        response: { status: 502 },
      });
      mockRequest.mockRejectedValue(badGateway);
      expect(await loadAndCatch()).toBe(badGateway);
    });

    it('an unrecognised code is rethrown unchanged', async () => {
      // The allowlist is closed: a code nobody has decided a meaning for stays
      // a distinguishable 500 rather than being folded into "not found".
      const unknown = gqlError('SOME_NEW_CODE');
      mockRequest.mockRejectedValue(unknown);
      expect(await loadAndCatch()).toBe(unknown);
    });

    it('AmbiguousLegacyUrnError is rethrown, NOT reported as not-found', async () => {
      // That code means the ref names MORE than one org — the opposite of
      // absent — and the server raises it to fail loudly rather than resolve to
      // an arbitrary one. A 404 saying "Organization not found" would send the
      // reader looking for a deleted org instead of a URN collision.
      const ambiguous = gqlError('AmbiguousLegacyUrnError', 'ref matches two organizations');
      mockRequest.mockRejectedValue(ambiguous);
      expect(await loadAndCatch()).toBe(ambiguous);
    });
  });

  describe('a nested field failure (known limitation, pinned deliberately)', () => {
    it('a non-null nested field erroring nulls the org, so the whole surface 404s', async () => {
      // This pins a limitation, NOT a behaviour anyone wants — read the loader's
      // note before changing it.
      //
      // Every nested field ORGANIZATION_QUERY selects is non-null in the SDL
      // (members/memories/agents/subscriptions/exchangeConnections are all
      // [X!]!), while `organization(ref:)` is nullable. So a nested resolver
      // erroring propagates its null UP to `organization`: the payload is
      // `data.organization = null`, never a usable org next to an error. The
      // shape below is what the server can actually emit — an earlier version of
      // this file asserted `data: { organization: fakeOrg }`, which GraphQL
      // cannot produce, and thereby "proved" a salvage branch that was
      // unreachable by construction.
      //
      // Consequence: `exchangeConnections` refusing for a non-admin member
      // replaces every tab of their own org with "Organization not found". That
      // is pre-existing (the old blanket catch did the same) and is fixed by
      // splitting the query or changing nullability server-side, not here.
      const nested = Object.assign(new Error('exchangeConnections failed'), {
        response: {
          data: { organization: null },
          errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }],
        },
      });
      mockRequest.mockRejectedValue(nested);
      expect((await loadAndCatch() as { status: number }).status).toBe(404);
    });
  });
});

/**
 * #845 — the regression guard for the FIX, not for the symptom.
 *
 * The defect was never in this loader's logic; it was in what the loader ASKED
 * FOR. Every nested field on Organization is non-null in the SDL while
 * `organization(ref:)` is nullable, so a nested resolver failing propagates its
 * null up to `organization`, and a layout that cannot tell that from a missing
 * org renders "Organization not found" across every tab.
 *
 * A scalar-only selection has nothing nested to fail. So the thing worth
 * pinning is the SHAPE of the document — asserted structurally (nesting depth)
 * rather than by listing today's field names, because a list added next year
 * under a name nobody predicted is exactly the case a name-based check misses.
 */
describe('#845 — ORG_CHROME_QUERY selects no nested field', () => {
  function maxDepth(doc: string): number {
    let depth = 0;
    let max = 0;
    for (const ch of doc) {
      if (ch === '{') max = Math.max(max, ++depth);
      else if (ch === '}') depth--;
    }
    return max;
  }

  it('nests exactly two levels: the operation, then organization', () => {
    // 2 = `query { organization { …scalars } }`. Three would mean a selection
    // set inside `organization`, i.e. a resolver that can null the whole org.
    expect(maxDepth(ORG_CHROME_QUERY)).toBe(2);
  });

  it('the depth check can actually fail', () => {
    // hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail —
    // a structural assertion that never trips on the shape it forbids is
    // decoration. This is the shape it forbids.
    const withNested = `query OrgChrome($ref: ID!) { organization(ref: $ref) { id members { id } } }`;
    expect(maxDepth(withNested)).toBe(3);
  });

  it('still asks for the three fields the chrome renders', () => {
    // The other direction: a query that selects nothing would pass the depth
    // check and break every header on the org surface.
    for (const field of ['id', 'name', 'urn']) {
      expect(ORG_CHROME_QUERY).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });
});
