/**
 * #735 — the worker page loader. Mocks the server's `worker(ref:)` query and
 * asserts the page reads the right worker, and that a refusal is
 * indistinguishable from a miss (the server's own posture: the roster must not
 * be an existence oracle).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { WORKER_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: (...args: unknown[]) => mockRequest(...args) }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

function ev(id = 'w-1') {
  return {
    params: { id },
    locals: { user: { id: 'u1' }, token: 'tok' },
  } as never;
}

async function runLoad(id = 'w-1') {
  const { load } = await import('./+page.server');
  return (await load(ev(id))) as { worker: Record<string, unknown> };
}

async function expectStatus(id = 'w-1'): Promise<number> {
  const { load } = await import('./+page.server');
  try {
    await load(ev(id));
  } catch (e) {
    return (e as { status: number }).status;
  }
  throw new Error('Expected load to throw, but it returned normally');
}

/** A GraphQL ClientError carrying one coded error. */
function gqlError(code: string) {
  return new ClientError(
    { errors: [{ message: 'nope', extensions: { code } }], status: 200 } as never,
    { query: '' } as never,
  );
}

const WORKER = {
  id: 'w-1',
  appId: 'app-1',
  agentId: 'a-1',
  name: 'Gil',
  slug: 'gil',
  urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:gil',
  role: 'portal-engineer',
  promptOverride: null,
  memoryId: 'mem-9',
  retiredAt: null,
  createdAt: '2026-08-16T09:00:00Z',
  agent: { id: 'a-1', name: 'Portal Engineer', urn: 'hrn:agent:x:pe', personaRole: 'portal-engineer' },
  app: { id: 'app-1', name: 'Hadron Dev Team', urn: 'hrn:app:hadronmemory.com:hadron-dev-team' },
};

describe('worker page load', () => {
  it('reads the worker by the route id and returns it', async () => {
    mockRequest.mockResolvedValueOnce({ worker: WORKER });
    const data = await runLoad('w-1');
    expect(data.worker).toMatchObject({ name: 'Gil', urn: WORKER.urn });
    expect(mockRequest.mock.calls[0][0]).toBe(WORKER_QUERY);
    expect(mockRequest.mock.calls[0][1]).toEqual({ ref: 'w-1' });
  });

  it('404s when the worker resolves null', async () => {
    mockRequest.mockResolvedValueOnce({ worker: null });
    expect(await expectStatus()).toBe(404);
  });

  // The server reports a denied NAME-form read as WORKER_NOT_FOUND precisely so
  // the roster is not an existence oracle. The portal must not undo that by
  // rendering a distinguishable "forbidden" page.
  it.each(['WORKER_NOT_FOUND', 'NOT_FOUND', 'FORBIDDEN'])(
    'reports %s as an indistinguishable 404',
    async (code) => {
      mockRequest.mockRejectedValueOnce(gqlError(code));
      expect(await expectStatus()).toBe(404);
    },
  );

  // review:clienterror-map-known-codes-only — an unknown code or a payload-less
  // transport failure must stay a 500, or an outage gets mislabelled as
  // "no such worker" and someone goes looking for a deleted row.
  //
  // The first version of this test was a guard that COULD NOT FAIL, caught by
  // Codex on #742. It called `runLoad()` (consuming the one-shot rejection) and
  // then `expectStatus()`, which ran the loader a second time against a mock
  // now returning undefined — destructuring that threw a TypeError whose
  // `.status` is undefined, and `undefined !== 404` passed trivially. It would
  // have stayed green even if the loader started mapping INTERNAL_SERVER_ERROR
  // to a 404, which is the only thing it was there to prevent.
  //
  // Now it asserts on the ONE rejection it seeds: the error must propagate, and
  // must not be a 404. (review:guard-must-be-proven-to-fail — mutation-checked
  // by making the loader map this code to 404, which reds it.)
  it('rethrows an unknown GraphQL error code rather than calling it a 404', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('INTERNAL_SERVER_ERROR'));
    const { load } = await import('./+page.server');
    let thrown: unknown;
    try {
      await load(ev());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    // A SvelteKit `error(404, …)` throws an object with status 404; the
    // rethrown ClientError has no `status` at all. Either way it must not be a
    // 404, and it must have actually thrown.
    expect((thrown as { status?: number }).status).not.toBe(404);
    expect(thrown).toBeInstanceOf(ClientError);
  });

  it('rethrows a non-GraphQL failure (transient outage is not a not-found)', async () => {
    mockRequest.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(runLoad()).rejects.toThrow('socket hang up');
  });

  // A worker whose App URN predates flat grammar-v2 has no URN. That is a fact
  // about the App, not an error, so the page must still load.
  it('loads a worker with no URN', async () => {
    mockRequest.mockResolvedValueOnce({ worker: { ...WORKER, urn: null, slug: null } });
    const data = await runLoad();
    expect(data.worker.urn).toBeNull();
    expect(data.worker.name).toBe('Gil');
  });

  it('loads a retired worker rather than hiding it', async () => {
    mockRequest.mockResolvedValueOnce({
      worker: { ...WORKER, retiredAt: '2026-08-17T10:00:00Z' },
    });
    const data = await runLoad();
    expect(data.worker.retiredAt).toBe('2026-08-17T10:00:00Z');
  });
});

describe('WORKER_QUERY selection', () => {
  // Selecting `prompt` re-renders the multi-KB boot briefing live. Putting that
  // in a page payload is the defect hadron-cli#459 is open about for
  // `worker list --json`; #737 covers showing it behind an explicit expand.
  it('does not select the boot prompt', () => {
    expect(WORKER_QUERY).not.toMatch(/^\s*prompt\s*$/m);
  });

  // The URN is the whole point of the page — without it the identity chip and
  // the copyable link both vanish silently.
  it('selects urn and slug', () => {
    expect(WORKER_QUERY).toMatch(/^\s*urn\s*$/m);
    expect(WORKER_QUERY).toMatch(/^\s*slug\s*$/m);
  });

  // The breadcrumb's "Apps" link must go to the ORG app list for an org-owned
  // App: /app/apps is the org-less "My apps" list (#647) and would not contain
  // the team App the reader just came from. That destination is chosen from
  // `app.organizationId`, so the query has to select it. Codex on #742.
  it('selects the App organizationId the breadcrumb needs', () => {
    expect(WORKER_QUERY).toMatch(/app\s*\{[^}]*\borganizationId\b/);
  });

  // The resolver hands over only a worker id, so Worker.app is what lets the
  // page name and link the team.
  it('selects the App so the page can link it', () => {
    expect(WORKER_QUERY).toMatch(/app\s*\{[^}]*\bname\b/);
  });
});
