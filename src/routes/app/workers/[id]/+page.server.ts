import { error } from '@sveltejs/kit';
import { ClientError } from 'graphql-request';
import { gqlClient } from '$lib/server/api';
import { WORKER_QUERY } from '$lib/server/queries';
import type { Worker } from '$lib/types';
import type { PageServerLoad } from './$types';

/**
 * The worker page (#735) — the canonical destination for a `hrn:worker:` URN.
 *
 * It exists because hadron-server#1008 has every worker sign outward-facing
 * artifacts with a clickable URN so a reader "can see who you are rather than
 * guessing whether a human wrote it". That reader is arriving from a GitHub
 * issue asking *who is this*, and until now they landed on a 404 — the portal
 * resolved no `worker` kind even though the server has since #991.
 *
 * Deliberately a page rather than a redirect to the App's Staff tab: a roster
 * answers "which team", not "who is this". #737 grows this page with the
 * worker's sessions and worklog, which is the other half of that question.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
  let worker: Worker | null;
  try {
    ({ worker } = await gqlClient(locals.token).request<{ worker: Worker | null }>(WORKER_QUERY, {
      ref: params.id,
    }));
  } catch (err) {
    // The worker read is gated server-side (`requireWorkerReadAccess`), and for
    // the NAME form a denial is deliberately reported as WORKER_NOT_FOUND so
    // the roster is not an existence oracle. Mirror that here: a refusal and a
    // miss both surface as the same 404, and only KNOWN codes are mapped —
    // anything else rethrows so an outage stays a distinguishable 500
    // (review:clienterror-map-known-codes-only, review:no-silent-loader-catch).
    if (err instanceof ClientError && err.response?.errors?.length) {
      const code = (err.response.errors[0].extensions as { code?: string } | undefined)?.code;
      if (code === 'WORKER_NOT_FOUND' || code === 'NOT_FOUND' || code === 'FORBIDDEN') {
        throw error(404, 'No worker found here, or you do not have access to it.');
      }
    }
    throw err;
  }

  if (!worker) {
    throw error(404, 'No worker found here, or you do not have access to it.');
  }

  return { worker };
};
