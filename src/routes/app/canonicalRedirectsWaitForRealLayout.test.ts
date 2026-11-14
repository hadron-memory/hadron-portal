// #1738 (Refs #1394; does not claim a cause): the five canonical-address
// redirects wait for the app layout's active-org cookie write, exactly like the
// nine routes #1732/#1733 covered. Each case runs the REAL
// `src/routes/app/+layout.server.ts` (only GraphQL mocked) as parent() of the
// REAL page load, in parallel the way SvelteKit runs them.
//
// Three pins per redirect site:
//   held      — the layout's GraphQL has not answered: no redirect yet;
//   cookie    — once it answers, the layout's active-org `cookies.set` has
//               happened when the redirect is thrown, and the redirect keeps its
//               status and target (and query where the route carries one);
//   rejecting — a layout that redirects (signed-out visitor) propagates instead
//               of the canonical redirect (the #1733 trade-off, accepted for
//               these five by the #1738 disposition, AT0.5080.3).
// Scope note: none of these routes has an org `params.id`, so on the source
// request the layout resolves the org from the existing cookie ('lastActive')
// and REFRESHES it; the URL-hint write happens when the target's own layout runs
// (`/app/orgs/[id]`, `/app/org/[id]`). The seeded cookie below is that refresh.
// The `definitions` route and the /signin?redirect= branches are out of scope.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClientError } from 'graphql-request';

const world = vi.hoisted(() => ({
  gate: Promise.resolve() as Promise<void>,
  release: (() => {}) as () => void,
  answers: {} as Record<string, unknown | (() => unknown)>,
}));

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({
    request: async (query: string) => {
      const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? '';
      if (op === 'OrganizationsNav' || op === 'Me') {
        await world.gate; // the layout's awaits: the cookie is written only after them
        if (op === 'Me') return { me: { id: 'user-1', name: 'U', email: 'u@example.com', handle: 'u', avatarUrl: null } };
        const org = {
          id: 'org-1', name: 'Org 1', urn: 'org:org-1', githubInstallationId: null, githubAppId: null,
          hasGithubAppPrivateKey: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
          members: [{ id: 'm1', role: 'MEMBER', user: { id: 'user-1' } }],
        };
        return { organizations: { items: [org], total: 1 } };
      }
      const a = world.answers[op];
      if (a === undefined) throw new Error(`unexpected operation ${op}`);
      if (typeof a === 'function') return (a as () => unknown)();
      return a;
    },
  }),
}));

type Load = (e: unknown) => unknown;
type Row = {
  name: string;
  mod: () => Promise<{ load: unknown }>;
  path: string; // URL path under http://localhost
  params: Record<string, string>;
  answers: Record<string, unknown | (() => unknown)>;
  status: number;
  location: string;
};

const APP = { id: 'app-1', urn: 'hrn:app:example.com:app-1' };
const urnRow = (name: string, urn: string, answers: Row['answers'], location: string, search = '?tab=x'): Row => ({
  name,
  mod: () => import('./u/[urn]/+page.server'),
  path: `/app/u/${encodeURIComponent(urn)}${search}`,
  params: { urn },
  answers,
  status: 307,
  location: location + search,
});
const clientError = (code: string) =>
  new ClientError({ status: 200, errors: [{ message: 'x', extensions: { code } }] } as never, { query: '' });

const ROWS: Row[] = [
  {
    name: 'apps/[appId]/tasks (blank text -> cleaned query)',
    mod: () => import('./apps/[appId]/tasks/+page.server'),
    path: '/app/apps/app-1/tasks?text=&status=open',
    params: { appId: 'app-1' },
    answers: { AgentTasksApp: { app: APP } },
    status: 303,
    location: '/app/apps/app-1/tasks?status=open',
  },
  {
    name: 'apps/[appId]/tasks/[taskId] (task in another App)',
    mod: () => import('./apps/[appId]/tasks/[taskId]/+page.server'),
    path: '/app/apps/app-1/tasks/task-1',
    params: { appId: 'app-1', taskId: 'task-1' },
    answers: { AgentTasksApp: { app: APP }, AgentTaskDetail: { agentTask: { id: 'task-1', appId: 'app-2' } } },
    status: 303,
    location: '/app/apps/app-2/tasks/task-1',
  },
  {
    name: 'apps/[appId]/tickers/[tickerId] (ticker in another App, keeps query)',
    mod: () => import('./apps/[appId]/tickers/[tickerId]/+page.server'),
    path: '/app/apps/app-1/tickers/tk-1?after=c1',
    params: { appId: 'app-1', tickerId: 'tk-1' },
    answers: { AgentTasksApp: { app: APP }, Ticker: { ticker: { id: 'tk-1', app: { id: 'app-2' } } } },
    status: 307,
    location: '/app/apps/app-2/tickers/tk-1?after=c1',
  },
  {
    name: 'apps/[appId]/runs/[runId] (run in another App)',
    mod: () => import('./apps/[appId]/runs/[runId]/+page.server'),
    path: '/app/apps/app-1/runs/run-1',
    params: { appId: 'app-1', runId: 'run-1' },
    answers: { AgentTasksApp: { app: APP }, AppRun: { appRun: { id: 'run-1', appId: 'app-2' } } },
    status: 303,
    location: '/app/apps/app-2/runs/run-1',
  },
  urnRow('u/[urn] resolved kind (memory)', 'hrn:mem:example.com:m1',
    { ResolveUrn: { resolveUrn: { kind: 'memory', id: 'mem-1', memoryId: null, organizationId: null } } }, '/app/memories/mem-1'),
  urnRow('u/[urn] ticker URN', 'hrn:ticker:example.com:app-2:tk-1',
    { Ticker: { ticker: { id: 'tk-1', app: { id: 'app-2' } } } }, '/app/apps/app-2/tickers/tk-1'),
  urnRow('u/[urn] unresolved org URN, public org', 'hrn:org:example.com',
    { ResolveUrn: { resolveUrn: null }, PublicOrganizationRoute: { publicOrganization: { id: 'org-9' } } }, '/app/org/org-9'),
  urnRow('u/[urn] refused org URN, public org', 'hrn:org:example.com',
    { ResolveUrn: () => { throw clientError('FORBIDDEN'); }, PublicOrganizationRoute: { publicOrganization: { id: 'org-9' } } }, '/app/org/org-9'),
];

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function makeJar() {
  const jar = new Map<string, string>([['hadron_active_org_user-1', 'org-1']]);
  const writes: string[] = [];
  return {
    jar,
    writes,
    cookies: {
      get: (n: string) => jar.get(n),
      set: (n: string, v: string) => { writes.push(n); jar.set(n, v); },
      delete: (n: string) => { jar.delete(n); },
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      serialize: (n: string, v: string) => `${n}=${v}`,
    },
  };
}

async function drive(row: Row, opts: { signedIn: boolean }) {
  const layout = (await import('./+layout.server')).load as Load;
  const { load } = await row.mod();
  const { writes, cookies } = makeJar();
  const locals = { user: opts.signedIn ? { id: 'user-1', roles: ['user'], githubUsername: 'gh' } : null, token: 't' };
  const url = new URL(`http://localhost${row.path}`);
  // SvelteKit starts layout and page loads together; the page's parent() is the layout's promise.
  const layoutRun = (async () =>
    layout({ locals, url, params: row.params, cookies, parent: async () => ({ user: { id: 'user-1' } }) }))();
  layoutRun.catch(() => {}); // a rejecting layout is observed through the page's parent()
  let settled = false;
  let thrown: unknown;
  let writesAtSettle = -1;
  const pageRun = (async () => (load as Load)({ params: row.params, url, locals, parent: () => layoutRun }))().then(
    () => { settled = true; },
    (e) => { settled = true; thrown = e; writesAtSettle = writes.length; },
  );
  return { pageRun, isSettled: () => settled, thrown: () => thrown, writesAtSettle: () => writesAtSettle };
}

beforeEach(() => {
  world.gate = new Promise<void>((resolve) => { world.release = resolve; });
});

describe('the five canonical redirects wait for the real app layout (#1738, Refs #1394)', () => {
  it.each(ROWS)('$name: held layout holds the redirect, then the cookie is set and the redirect is unchanged', async (row) => {
    world.answers = row.answers;
    const run = await drive(row, { signedIn: true });
    await flush();
    expect(run.isSettled()).toBe(false); // the layout's GraphQL has not answered
    world.release();
    await run.pageRun;
    expect(run.thrown()).toMatchObject({ status: row.status, location: row.location });
    expect(run.writesAtSettle()).toBe(1); // the layout's cookies.set landed before the redirect settled
  });

  it.each(ROWS)('$name: a layout that redirects propagates instead of the canonical redirect', async (row) => {
    world.answers = row.answers;
    world.release();
    const run = await drive(row, { signedIn: false });
    await run.pageRun;
    const source = new URL(`http://localhost${row.path}`);
    expect(run.thrown()).toMatchObject({
      status: 303,
      location: `/signin?redirect=${encodeURIComponent(source.pathname + source.search)}`,
    });
  });
});
