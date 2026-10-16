import { error, fail, redirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import {
  APP_RUN_QUERY,
  APP_RUN_ENVELOPE_QUERY,
  CANCEL_APP_RUN_MUTATION,
} from '$lib/server/queries';
import type { AppRun } from '$lib/flow/runs';
import { isAccessRefusal, loadTasksApp } from '$lib/server/agent-tasks';
import type { Actions, PageServerLoad } from './$types';
import { cancelAppRunSchema } from './schema';

// Run detail (#478 phase 3): the full audit record — who/what/why, budgets,
// live position (curNodeUrn while RUNNING), the envelope, failure payload —
// plus the kill switch.
export const load: PageServerLoad = async ({ params, locals }) => {
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
    redirect(303, `/app/apps/${run.appId}/runs/${run.id}`);
  }

  // The envelope needs hadron-server#534 (AppRun.data in the schema). On an
  // older server the SELECTION itself is invalid and the whole query errors —
  // so it rides a separate query and degrades to "unavailable" instead of
  // breaking the page. This catch only guards the auxiliary envelope; the
  // run itself loaded above (no false-404 risk — hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch).
  let envelope: Record<string, unknown> | null = null;
  let envelopeSupported = true;
  try {
    const res = await client.request<{ appRun: { data: Record<string, unknown> | null } | null }>(
      APP_RUN_ENVELOPE_QUERY,
      { ref: params.runId },
    );
    envelope = res.appRun?.data ?? null;
  } catch (e) {
    envelopeSupported = false;
    console.warn(`[run-detail] envelope fetch failed for ${params.runId} (server without #534?):`, e);
  }

  const cancelForm = await superValidate(zod4(cancelAppRunSchema), { errors: false });

  return { app, run, envelope, envelopeSupported, cancelForm };
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
      return message(form, { type: 'error' as const, text: extractGqlError(e, 'Failed to cancel run') }, { status: 500 });
    }
  },
};
