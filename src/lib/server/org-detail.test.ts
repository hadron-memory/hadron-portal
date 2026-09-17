/**
 * `loadOrgDetail` — what a tab does when its slice of the org fails (#845).
 *
 * @copilot on #847 caught that the first version of this helper advertised a
 * per-tab 404 and delivered a 500: `graphql-request` rejects on ANY GraphQL
 * error, so a null-propagated org arrives as a REJECTION carrying
 * `data.organization === null` and never reaches a plain `if (!data.organization)`.
 * That is the single most important case here, because it is the exact shape
 * the whole issue is about — a non-null nested list failing and nulling its
 * parent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Imported dynamically, after vi.mock is applied — the pattern the other
 *  loader suites in this repo use. A static import binds the real
 *  `$lib/server/api` before the mock lands. */
async function importLoadOrgDetail() {
  return (await import('./org-detail')).loadOrgDetail;
}

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  // Block body, NOT `() => mockRequest.mockReset()`. `mockReset()` returns the
  // mock, vitest treats a FUNCTION returned from a hook as a teardown callback,
  // and it therefore CALLS the mock after each test — which, with a rejecting
  // implementation still installed, produces an unhandled rejection that the
  // runner blames on the test that just passed. Cost an hour to trace.
  mockRequest.mockReset();
});

const DOC = 'query X($ref: ID!) { organization(ref: $ref) { id } }';
const org = { id: 'org-1', name: 'Acme', urn: 'urn:org:acme' };

/**
 * Reject at CALL time, not at setup time.
 *
 * `mockRejectedValue(x)` can materialise the rejected promise when the mock is
 * configured; the dynamic `import()` on the next line then lets a tick pass
 * with nothing attached to it, Node reports an unhandled rejection, and vitest
 * fails the test with the raw error even though the code under test handles it
 * perfectly. Building the promise inside the implementation ties its creation
 * to the call that consumes it.
 */
function mockRejects(value: unknown) {
  mockRequest.mockImplementation(() => Promise.reject(value));
}

/** A graphql-request rejection: an Error carrying the GraphQL response. */
function rejection(response: unknown) {
  return Object.assign(new Error('GraphQL Error'), { response });
}

/** The rejection `loadOrgDetail` produces, as a value to assert on. */
async function rejectsWith(): Promise<{ status?: number } & Record<string, unknown>> {
  const loadOrgDetail = await importLoadOrgDetail();
  return await loadOrgDetail('tok', 'org-1', DOC).then(
    () => {
      throw new Error('expected loadOrgDetail to throw');
    },
    (e: unknown) => e as { status?: number } & Record<string, unknown>,
  );
}

describe('loadOrgDetail', () => {
  it('returns the org on a clean response, and passes the document through', async () => {
    mockRequest.mockResolvedValue({ organization: org });
    const loadOrgDetail = await importLoadOrgDetail();
    await expect(loadOrgDetail('tok', 'org-1', DOC)).resolves.toEqual(org);
    expect(mockRequest).toHaveBeenCalledWith(DOC, { ref: 'org-1' });
  });

  it('a clean null org is this tab 404', async () => {
    mockRequest.mockResolvedValue({ organization: null });
    expect((await rejectsWith()).status).toBe(404);
  });

  // THE case. A non-null nested list erroring propagates its null up to
  // `organization`, and graphql-request turns that whole response into a
  // rejection — so the payload has to be read off the error, not the resolve.
  it('null propagation (a rejection carrying organization: null) is a 404, NOT a 500', async () => {
    mockRejects(
      rejection({
        data: { organization: null },
        errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }],
      }),
    );
    const thrown = await rejectsWith();
    expect(thrown.status).toBe(404);
    // Pinning the inverse explicitly: this is what it used to do.
    expect(thrown.status).not.toBe(500);
  });

  it.each(['ORGANIZATION_NOT_FOUND', 'FORBIDDEN'])(
    'a %s with no data payload is a 404',
    async (code) => {
      mockRejects(rejection({ errors: [{ message: 'x', extensions: { code } }] }));
      expect((await rejectsWith()).status).toBe(404);
    },
  );

  it('a transport failure is rethrown unchanged, so an outage stays a 500', async () => {
    // Same rule as the org layout: no GraphQL payload at all cannot be a
    // refusal, and must not be reported as "not found".
    const boom = new Error('fetch failed');
    mockRejects(boom);
    expect(await rejectsWith()).toBe(boom);
  });

  it('an unrecognised code is rethrown unchanged', async () => {
    const unknown = rejection({ errors: [{ message: 'x', extensions: { code: 'SOME_NEW_CODE' } }] });
    mockRejects(unknown);
    expect(await rejectsWith()).toBe(unknown);
  });

  it('a rejection whose payload HAS an org still returns it', async () => {
    // A nested field failing WITHOUT null-propagating (a nullable one) leaves
    // the org usable; erroring the tab then would be the opposite mistake.
    mockRejects(
      rejection({ data: { organization: org }, errors: [{ message: 'partial' }] }),
    );
    const loadOrgDetail = await importLoadOrgDetail();
    await expect(loadOrgDetail('tok', 'org-1', DOC)).resolves.toEqual(org);
  });
});
