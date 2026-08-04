import { redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { STOP_IMPERSONATION_MUTATION } from '$lib/server/queries';
import type { Actions } from './$types';

/**
 * Ends the current impersonation session: best-effort stopImpersonation on
 * the server (self-stop with the impersonation token; the session row is the
 * revocation source of truth), then delete the cookie — the admin's own
 * hadron_token session takes over on the next request. A failed mutation is
 * non-fatal: the cookie delete alone locks this browser out, and the session
 * lapses by TTL server-side.
 */
export const actions: Actions = {
  default: async ({ cookies, locals }) => {
    const impToken = cookies.get('hadron_impersonation');
    if (impToken && locals.impersonation) {
      try {
        await gqlClient(impToken).request(STOP_IMPERSONATION_MUTATION, {});
      } catch {
        // Expected in normal use (token already expired, or the session was
        // stopped elsewhere), so this is a terse note rather than a dumped
        // error object — the TTL covers us either way, and the error can
        // carry response detail that doesn't belong in server logs
        // (PR #692 review).
        console.info('[impersonation] server-side stop did not apply; session will lapse by TTL');
      }
    }
    cookies.delete('hadron_impersonation', { path: '/' });
    redirect(303, '/app/dashboard');
  },
};
