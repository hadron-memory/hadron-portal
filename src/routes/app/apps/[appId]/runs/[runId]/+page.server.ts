import { error, fail, redirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import {
  APP_RUN_QUERY,
  APP_RUN_ENVELOPE_QUERY,
  APP_RUN_HOPS_QUERY,
  CANCEL_APP_RUN_MUTATION,
} from '$lib/server/queries';
import type { AppRun } from '$lib/flow/runs';
import { isAccessRefusal, loadTasksApp } from '$lib/server/agent-tasks';
import type { Actions, PageServerLoad } from './$types';
import { cancelAppRunSchema } from './schema';

/** The GraphQL validation error for a schema that predates AppRun.hops (hadron-server#538). */
function isMissingHopsField(e: unknown): boolean {
  return e instanceof Error && e.message.includes('Cannot query field "hops"');
}

// Run detail (#478 phase 3): the full audit record — who/what/why, budgets,
// live position (curNodeUrn while RUNNING), the envelope, failure payload —
// plus the kill switch.
export const load: PageServerLoad = async ({ params, locals, parent }) => {
  // #648: canonical org-optional run detail. No requireNonConsumer — a run of a
  // user-owned (org-less) app is reachable here too; the app(ref:) gate is the
  // auth.
  const client = gqlClient(locals.token);

  // portal#1130: the App first and alone. A viewer the server conceals it
  // from gets the App page's 404, not a 500; any other failure stays one.
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');

  const runData = await client
    .request<{ appRun: AppRun | null }>(APP_RUN_QUERY, { ref: params.runId })
    .catch((e) => {
      // A run concealed from this viewer reads as missing, the same 404.
      if (isAccessRefusal(e)) throw error(404, 'Run not found');
      throw e;
    });
  const run = runData.appRun;
  if (!run) throw error(404, 'Run not found');

  // URL correction (#237 pattern): the run resolves by PK alone — a run reached
  // under the wrong app URL redirects to its canonical (org-independent) page.
  if (run.appId !== params.appId) {
    // #1738 (Refs #1394): wait for the app layout's active-org cookie write before redirecting.
    await parent();
    redirect(303, `/app/apps/${run.appId}/runs/${run.id}`);
  }

  // The envelope needs hadron-server#534 (AppRun.data in the schema). On an
  // older server the SELECTION itself is invalid and the whole query errors —
  // so it rides a separate query and degrades to "unavailable" instead of
  // breaking the page. This catch only guards the auxiliary envelope; the
  // run itself loaded above (no false-404 risk — hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch).
  // portal#2339 #2: the two are independent, so they are read together; each keeps its own degrade.
  const [envelopeRes, hopsRes] = await Promise.allSettled([
    client.request<{ appRun: { data: Record<string, unknown> | null } | null }>(APP_RUN_ENVELOPE_QUERY, { ref: params.runId }),
    client.request<{ appRun: { id: string; hops: unknown } | null }>(APP_RUN_HOPS_QUERY, { ref: params.runId }),
  ]);
  let envelope: Record<string, unknown> | null = null;
  let envelopeSupported = true;
  if (envelopeRes.status === 'fulfilled') {
    envelope = envelopeRes.value.appRun?.data ?? null;
  } else {
    envelopeSupported = false;
    console.warn(`[run-detail] envelope fetch failed for ${params.runId} (server without #534?):`, envelopeRes.reason);
  }

  // The completed-hops trail (hadron-server#538, #482): same degrade-don't-break
  // shape as the envelope. The result is stamped with the run it was read for so
  // the page can refuse a late or stale answer; an answer naming another run is
  // dropped to "no trail" rather than attached to this one.
  let trail: { runId: string; supported: boolean; raw: unknown } = { runId: run.id, supported: true, raw: null };
  if (hopsRes.status === 'fulfilled') {
    const res = hopsRes.value;
    trail = { runId: run.id, supported: true, raw: res.appRun?.id === run.id ? (res.appRun.hops ?? null) : null };
  } else {
    trail = { runId: run.id, supported: false, raw: null };
    // portal#2339 #3: only a schema without AppRun.hops is "server without #538"; any other failure is logged as itself.
    const e = hopsRes.reason;
    if (isMissingHopsField(e)) console.warn(`[run-detail] hops not supported by this server for ${params.runId} (server without #538):`, e);
    else console.warn(`[run-detail] hops fetch failed for ${params.runId} (${e instanceof Error ? e.name : typeof e}):`, e);
  }

  const cancelForm = await superValidate(zod4(cancelAppRunSchema), { errors: false });

  return { app, run, envelope, envelopeSupported, trail, cancelForm };
};

export const actions: Actions = {
  // The kill switch. Server-side the transition is guarded
  // (where status='RUNNING'/'PENDING'), so racing a finishing run is safe —
  // the terminal state wins and survives in the audit log.
  cancel: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), zod4(cancelAppRunSchema));
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(CANCEL_APP_RUN_MUTATION, { id: params.runId });
      return message(form, { type: 'success' as const, text: 'Run cancellation requested.' });
    } catch (e: unknown) {
      return message(form, { type: 'error' as const, text: extractGqlError(e, 'Failed to cancel run', [], { transport: 'fallback' }) }, { status: 500 });
    }
  },
};
