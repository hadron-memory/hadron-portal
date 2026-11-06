// #1732 (Refs #1394): every /app load that redirects on entry must wait for the
// parent (app layout) load first. The layout writes the active-org cookie AFTER
// its GraphQL awaits, and SvelteKit runs layout and page loads in parallel, so a
// redirect that settles first lets the response be generated while the layout's
// `cookies.set` is still to come. #1725 fixed the memory index; this pins the
// other entry redirects the audit found. Defensive: the root cause of #1394 is
// unconfirmed, so each route's verdict lives in the audit table on the PR.
import { describe, it, expect, vi } from 'vitest';

// `apps/[appId]/members` shares helpers that build a GraphQL client at import.
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: vi.fn().mockResolvedValue({}) }) }));

type Load = (e: unknown) => unknown;
type Row = {
  route: string;
  mod: () => Promise<{ load: unknown }>;
  params: Record<string, string>;
  search?: string;
  status: number;
  location: string;
};

const ROWS: Row[] = [
  { route: 'apps/[appId]/members', mod: () => import('./apps/[appId]/members/+page.server'), params: { appId: 'app-1' }, status: 307, location: '/app/apps/app-1?tab=members' },
  { route: 'dashboard/customize', mod: () => import('./dashboard/customize/+page.server'), params: {}, status: 301, location: '/app/dashboard' },
  { route: 'memories/[id]/browse', mod: () => import('./memories/[id]/browse/+page.server'), params: { id: 'mem-1' }, search: '?focus=n1', status: 308, location: '/app/memories/mem-1/graph?focus=n1' },
  { route: 'orgs/[id]/agents/[aid]', mod: () => import('./orgs/[id]/agents/[aid]/+page.server'), params: { id: 'org-1', aid: 'ag-1' }, status: 303, location: '/app/agents/ag-1' },
  { route: 'orgs/[id]/ai-configs', mod: () => import('./orgs/[id]/ai-configs/+page.server'), params: { id: 'org-1' }, status: 308, location: '/app/orgs/org-1/integrations' },
  { route: 'orgs/[id]/apps/[appId]', mod: () => import('./orgs/[id]/apps/[appId]/+page.server'), params: { id: 'org-1', appId: 'app-1' }, status: 303, location: '/app/apps/app-1' },
  { route: 'orgs/[id]/apps/[appId]/members', mod: () => import('./orgs/[id]/apps/[appId]/members/+page.server'), params: { id: 'org-1', appId: 'app-1' }, status: 303, location: '/app/apps/app-1/members' },
  { route: 'orgs/[id]/apps/[appId]/runs', mod: () => import('./orgs/[id]/apps/[appId]/runs/+page.server'), params: { id: 'org-1', appId: 'app-1' }, status: 303, location: '/app/apps/app-1/runs' },
  { route: 'orgs/[id]/apps/[appId]/runs/[runId]', mod: () => import('./orgs/[id]/apps/[appId]/runs/[runId]/+page.server'), params: { id: 'org-1', appId: 'app-1', runId: 'run-1' }, status: 303, location: '/app/apps/app-1/runs/run-1' },
];

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('entry redirects wait for the parent layout (#1732, Refs #1394)', () => {
  it.each(ROWS)('$route: no redirect until parent() resolves, then the same redirect', async (row) => {
    const { load } = await row.mod();
    let release!: () => void;
    const parent = new Promise<unknown>((resolve) => { release = () => resolve({}); });
    let settled: 'pending' | 'rejected' | 'resolved' = 'pending';
    let error: unknown;
    // `async` turns a synchronous throw into a rejection, so a load that
    // redirects before awaiting parent() settles here, before the release.
    const run = (async () => (load as Load)({
      params: row.params,
      url: new URL(`http://localhost/app/${row.route}${row.search ?? ''}`),
      locals: { token: 't' },
      parent: () => parent,
    }))().then(() => { settled = 'resolved'; }, (e) => { settled = 'rejected'; error = e; });
    await flush();
    expect(settled).toBe('pending');
    release();
    await run;
    expect(settled).toBe('rejected');
    expect(error).toMatchObject({ status: row.status, location: row.location });
  });

  it('a parent() that rejects (layout redirected or failed) propagates instead of redirecting', async () => {
    const { load } = await ROWS[1].mod();
    const boom = new Error('layout failed');
    await expect(
      (async () => (load as Load)({ params: {}, url: new URL('http://localhost/app/dashboard/customize'), locals: {}, parent: () => Promise.reject(boom) }))(),
    ).rejects.toBe(boom);
  });
});
