import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { ORG_APP_RUNS_QUERY, ORG_APP_INSTALLS_QUERY } from '$lib/server/queries';
import type { AppRun } from '$lib/flow/runs';
import { isAppRunRow } from '$lib/flow/app-runs-page';
import { parseOrgRunsSort } from '$lib/flow/org-runs-sort';
import type { PageServerLoad } from './$types';

// "App Runs" — every headless run (AppRun) across the ACTIVE org's apps, the
// org-wide sibling of the per-app audit list at /app/apps/[appId]/runs. Scoped
// to the org via `orgRef` (server gate: org READER); the org itself is loaded
// by the [id] layout, so this loader only fetches runs.
//
// Windowed, NOT server-paginated: the page renders a TanStack DataTable (client
// search / sort / saved views / pagination) over the most recent WINDOW runs,
// mirroring the Task Nodes page. Run history is unbounded, so the window is
// surfaced honestly in the UI when it truncates. Deeper history of a single app
// lives on that app's own server-paginated runs page.
//
// Status filtering is deliberately CLIENT-side (a `columnFilters` entry on the
// status column) rather than the server's `status` arg: saved views persist
// columnFilters but not the URL, so only the client filter can express a named
// "Unfinished" view — and the server arg takes a single AppRunStatus, so it
// can't express PENDING-or-RUNNING at all. Multi-status server filtering is
// hadron-server#836; when it lands, this can push the selection down and widen
// the window beyond the most-recent 200.
const WINDOW = 200; // the appRuns hard cap for one request

/** One org app, as the App column's id→name map consumes it. */
type AppInstall = { id: string; name: string; agentId: string | null };

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const client = gqlClient(locals.token);
  // portal#1499: Duration is the first column the server orders (the ruled end state is every column, in steps). The window is
  // the 200 runs in that order, so the longest run in the org leads even when it is older than the latest 200; the other
  // columns still sort inside the window. Unfinished runs (no duration) come last in BOTH directions: hadron-server orders
  // `durationMs` with `nulls: 'last'` (src/api/graphql/schema/resolvers.appRun.ts, pinned by resolvers.appRunDurationSort855.test.ts),
  // so they never crowd the longest runs out of the window. Anything but `sort=duration` keeps the default most-recent window.
  const { sort, dir } = parseOrgRunsSort(url.searchParams);

  const [runsResult, apps] = await Promise.all([
    // The list itself. A failure is reported as `failed` rather than an empty
    // list, so a transient error never renders as a truthful "no runs yet"
    // (hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch).
    client
      .request<{ appRuns: { items: AppRun[]; total: number } }>(ORG_APP_RUNS_QUERY, {
        orgRef: params.id,
        status: null,
        limit: WINDOW,
        offset: 0,
        ...(sort ? { sortBy: sort, sortDir: dir } : {}),
      })
      .then((d) => {
        // Refuse a malformed page before any formatter or table sees it: the per-app sibling does the same
        // (isRunsSection), and the failure path below is the banner, never an empty success.
        const page = d?.appRuns;
        if (!page || !Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < 0 || !page.items.every(isAppRunRow)) {
          throw new Error('Malformed runs page');
        }
        return { ok: true as const, ...page };
      })
      .catch((e: unknown) => {
        console.error(`[org runs] ORG_APP_RUNS_QUERY failed for ${params.id}:`, e);
        return { ok: false as const, items: [] as AppRun[], total: 0 };
      }),
    // App names for the App column. Auxiliary — on failure the column falls
    // back to the raw app id, which is still a correct (if uglier) identifier;
    // it never turns into a false "no runs".
    fetchAllItems<AppInstall>(client, ORG_APP_INSTALLS_QUERY, 'apps', { orgRef: params.id }).catch(
      (e: unknown) => {
        console.warn(`[org runs] app-name lookup failed for ${params.id}:`, e);
        return [] as AppInstall[];
      },
    ),
  ]);

  const appNames: Record<string, string> = {};
  for (const app of apps) appNames[app.id] = app.name;

  return {
    runs: runsResult.items,
    total: runsResult.total,
    failed: !runsResult.ok,
    // True when the org has more runs than the window shows — the UI says so
    // rather than silently capping.
    truncated: runsResult.total > runsResult.items.length,
    windowSize: WINDOW,
    sort,
    dir,
    appNames,
  };
};
