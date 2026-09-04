import { error, fail, redirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { APP_QUERY, APP_RUNS_QUERY, APP_NODES_QUERY, RUN_TASK_APP_MUTATION } from '$lib/server/queries';
import { flowRoots, type FlowGraphNode } from '$lib/flow/flows';
import { RUN_STATUSES, type AppRun, type AppRunStatus } from '$lib/flow/runs';
import type { App } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { runAppFlowSchema } from './schema';

// The runs audit list (#478 phase 3): what ran, why, what it cost, and the
// entry into the detail/kill-switch page. Server-paginated — a busy app's
// run history is unbounded, so no fetchAllItems here (deliberate divergence
// from the completion-pager rule; the page IS the pagination UI).
const PAGE_SIZE = 25;

export const load: PageServerLoad = async ({ params, locals, url }) => {
  // #648: canonical org-optional — runs are app-scoped (no org query); a
  // user-owned (org-less) app has runs too. The app(ref:) gate is the auth.
  const client = gqlClient(locals.token);

  const statusParam = url.searchParams.get('status');
  const status = RUN_STATUSES.includes(statusParam as AppRunStatus)
    ? (statusParam as AppRunStatus)
    : null;
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

  const [appData, runsData, nodesData] = await Promise.all([
    client.request<{ app: App | null }>(APP_QUERY, { ref: params.appId }),
    client.request<{ appRuns: { items: AppRun[]; total: number } }>(APP_RUNS_QUERY, {
      appRef: params.appId,
      status,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    // Flows this app can start (#483): derived from the app's accessible
    // nodes (runnable + routing edges, no schema marker). Best-effort — a
    // failure only hides the Flows section, never the audit list (auxiliary
    // data; hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch).
    client
      .request<{ appNodes: FlowGraphNode[] }>(APP_NODES_QUERY, { appRef: params.appId, limit: 500 })
      .catch((e) => {
        console.warn(`[runs] appNodes fetch failed for ${params.appId}:`, e);
        return { appNodes: [] as FlowGraphNode[] };
      }),
  ]);
  if (!appData.app) throw error(404, 'App not found');

  const runForm = await superValidate(zod4(runAppFlowSchema), { errors: false });

  return {
    app: appData.app,
    runs: runsData.appRuns.items,
    total: runsData.appRuns.total,
    page,
    pageSize: PAGE_SIZE,
    status,
    flows: flowRoots(nodesData.appNodes),
    runForm,
  };
};

export const actions: Actions = {
  // Start a flow from its entry node (#483): mints a MANUAL run via
  // runTask(urn, appRef:) — same backend as the node page's "Test flow",
  // without the payload escape hatch (that lives on the node page).
  run: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), zod4(runAppFlowSchema));
    if (!form.valid) return fail(400, { form });

    let runId: string;
    try {
      const res = await gqlClient(locals.token).request<{ runTask: string }>(RUN_TASK_APP_MUTATION, {
        nodeRef: form.data.entryUrn,
        appRef: params.appId,
        runAsSelf: false,
      });
      runId = res.runTask;
    } catch (e: unknown) {
      return message(form, { type: 'error' as const, text: extractGqlError(e, 'Failed to start the flow') }, { status: 500 });
    }
    redirect(303, `/app/apps/${params.appId}/runs/${runId}`);
  },
};
