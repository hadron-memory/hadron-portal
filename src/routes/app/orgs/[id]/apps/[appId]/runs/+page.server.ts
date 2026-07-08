import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { APP_QUERY, APP_RUNS_QUERY } from '$lib/server/queries';
import { RUN_STATUSES, type AppRun, type AppRunStatus } from '$lib/flow/runs';
import type { App } from '$lib/types';
import type { PageServerLoad } from './$types';

// The runs audit list (#478 phase 3): what ran, why, what it cost, and the
// entry into the detail/kill-switch page. Server-paginated — a busy app's
// run history is unbounded, so no fetchAllItems here (deliberate divergence
// from the completion-pager rule; the page IS the pagination UI).
const PAGE_SIZE = 25;

export const load: PageServerLoad = async ({ params, locals, parent, url }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);

  const statusParam = url.searchParams.get('status');
  const status = RUN_STATUSES.includes(statusParam as AppRunStatus)
    ? (statusParam as AppRunStatus)
    : null;
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

  const [appData, runsData] = await Promise.all([
    client.request<{ app: App | null }>(APP_QUERY, { id: params.appId }),
    client.request<{ appRuns: { items: AppRun[]; total: number } }>(APP_RUNS_QUERY, {
      appRef: params.appId,
      status,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
  ]);
  if (!appData.app) throw error(404, 'App not found');

  return {
    app: appData.app,
    runs: runsData.appRuns.items,
    total: runsData.appRuns.total,
    page,
    pageSize: PAGE_SIZE,
    status,
  };
};
