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
      } catch (e) {
        // Expired token / already-stopped session — the TTL covers us.
        console.warn('[impersonation] stop mutation failed (session will lapse by TTL):', e);
      }
    }
    cookies.delete('hadron_impersonation', { path: '/' });
    redirect(303, '/app/dashboard');
  },
};
