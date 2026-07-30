/**
 * Tests for the org-wide "App Runs" loader.
 *
 * The org itself (incl. 404 handling) is loaded by +layout.server.ts; this
 * loader only fetches the run window + the app-name map.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_APP_RUNS_QUERY, ORG_APP_INSTALLS_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
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
    status: string | null;
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

  it('passes a valid status through as a server filter', async () => {
    routeQueries({ runs: { items: [], total: 0 } });

    const result = await runLoad('?status=FAILED');

    expect(result.status).toBe('FAILED');
    expect(mockRequest).toHaveBeenCalledWith(ORG_APP_RUNS_QUERY, expect.objectContaining({ status: 'FAILED' }));
  });

  it('ignores an unknown status rather than sending it to the server', async () => {
    routeQueries({ runs: { items: [], total: 0 } });

    const result = await runLoad('?status=BOGUS');

    expect(result.status).toBeNull();
    expect(mockRequest).toHaveBeenCalledWith(ORG_APP_RUNS_QUERY, expect.objectContaining({ status: null }));
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
});
