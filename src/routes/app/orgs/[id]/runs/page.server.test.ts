/**
 * Tests for the org-wide "App Runs" loader.
 *
 * The org itself (incl. 404 handling) is loaded by +layout.server.ts; this
 * loader only fetches the run window + the app-name map.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_APP_RUNS_QUERY, ORG_APP_INSTALLS_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

// Module-scope spies + an explicit restore, matching the repo's other loader
// tests (dashboard, usage/activity). Re-spying in beforeEach would wrap an
// already-wrapped method once per test and never unwind it.
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
afterAll(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

beforeEach(() => {
  mockRequest.mockReset();
});

const run = {
  id: 'run-1',
  organizationId: 'org-1',
  appId: 'app-1',
  agentId: null,
  userId: null,
  triggerKind: 'SCHEDULE',
  triggerId: 'sched-1',
  entryNodeUrn: 'hrn:node:acme.com::flows::entry',
  eventData: { scheduleName: 'morning-digest' },
  policy: null,
  budgetTokens: 1000,
  budgetActions: 10,
  status: 'COMPLETED',
  curNodeUrn: null,
  parentRunId: null,
  failure: null,
  timeoutMs: null,
  attempts: 1,
  startedAt: '1750000000000',
  finishedAt: '1750000003000',
  createdAt: '1750000000000',
  createdBy: null,
};

function routeQueries(opts: {
  runs?: { items: unknown[]; total: number };
  runsError?: Error;
  appsError?: Error;
} = {}) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === ORG_APP_RUNS_QUERY) {
      if (opts.runsError) throw opts.runsError;
      return { appRuns: opts.runs ?? { items: [run], total: 1 } };
    }
    if (query === ORG_APP_INSTALLS_QUERY) {
      if (opts.appsError) throw opts.appsError;
      return { apps: { items: [{ id: 'app-1', name: 'Digest', agentId: null }], total: 1 } };
    }
    throw new Error(`unexpected query: ${query.slice(0, 60)}`);
  });
}

async function runLoad(search = '') {
  const { load } = await import('./+page.server');
  return load({
    params: { id: 'org-1' },
    locals: { token: 'tok' },
    url: new URL(`https://example.test/app/orgs/org-1/runs${search}`),
  } as unknown as Parameters<typeof load>[0]) as Promise<{
    runs: Array<{ id: string }>;
    total: number;
    failed: boolean;
    truncated: boolean;
    appNames: Record<string, string>;
  }>;
}

describe('org App Runs load()', () => {
  it('scopes the run query to the org and maps app ids to names', async () => {
    routeQueries();

    const result = await runLoad();

    expect(mockRequest).toHaveBeenCalledWith(ORG_APP_RUNS_QUERY, {
      orgRef: 'org-1',
      status: null,
      limit: 200,
      offset: 0,
    });
    expect(result.runs.map((r) => r.id)).toEqual(['run-1']);
    expect(result.appNames).toEqual({ 'app-1': 'Digest' });
    expect(result.failed).toBe(false);
    expect(result.truncated).toBe(false);
  });

  // Status filtering moved client-side (a `columnFilters` entry, so a saved
  // view can pin "Unfinished" = PENDING + RUNNING). The loader must therefore
  // fetch the window UNFILTERED — a leftover ?status= narrowing the server
  // query would silently hide rows the client filter expects to have.
  it('always fetches the window unfiltered, ignoring a ?status= query param', async () => {
    routeQueries();

    const result = await runLoad('?status=FAILED');

    expect(mockRequest).toHaveBeenCalledWith(ORG_APP_RUNS_QUERY, expect.objectContaining({ status: null }));
    expect(result.runs).toHaveLength(1);
    expect(result).not.toHaveProperty('status');
  });

  it('flags truncation when the org has more runs than the window holds', async () => {
    routeQueries({ runs: { items: [run], total: 1_342 } });

    const result = await runLoad();

    expect(result.truncated).toBe(true);
    expect(result.total).toBe(1_342);
  });

  it('reports a failed run query instead of rendering it as "no runs"', async () => {
    routeQueries({ runsError: new Error('boom') });

    const result = await runLoad();

    expect(result.failed).toBe(true);
    expect(result.runs).toEqual([]);
  });

  it('keeps the list when only the app-name lookup fails', async () => {
    routeQueries({ appsError: new Error('nope') });

    const result = await runLoad();

    expect(result.failed).toBe(false);
    expect(result.runs).toHaveLength(1);
    expect(result.appNames).toEqual({});
  });

  // Defence in depth: the SDL says entryNodeUrn is String! and the client rejects any GraphQL error, so a real
  // server cannot send these. A contract-violating or future-nullable server must still degrade to the failure
  // banner (the per-app sibling does, via isRunsSection), never throw during render and 500 the whole list.
  it.each([
    ['a null entryNodeUrn', { ...run, entryNodeUrn: null }],
    ['a missing entryNodeUrn', (({ entryNodeUrn: _drop, ...rest }) => rest)(run)],
    ['a non-string status', { ...run, status: 7 }],
    ['a row that is not an object', null],
  ])('a malformed row (%s) is the failure banner, never a 500 and never an empty success', async (_label, bad) => {
    routeQueries({ runs: { items: [run, bad], total: 2 } });

    const result = await runLoad();

    expect(result.failed).toBe(true);
    expect(result.runs).toEqual([]);
    expect(result.total).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it.each([
    ['items that are not an array', { items: null, total: 0 }],
    ['a total that is not a count', { items: [run], total: -1 }],
    ['a page with no items field', { total: 1 }],
  ])('a malformed page (%s) is the failure banner', async (_label, runs) => {
    routeQueries({ runs: runs as never });

    expect((await runLoad()).failed).toBe(true);
  });

  it('a full window of well-formed rows (more than one per-app page) still loads', async () => {
    const window = Array.from({ length: 200 }, (_, i) => ({ ...run, id: `run-${i}` }));
    routeQueries({ runs: { items: window, total: 200 } });

    const result = await runLoad();

    expect(result.failed).toBe(false);
    expect(result.runs).toHaveLength(200);
  });
});
