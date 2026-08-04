import { redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { STOP_IMPERSONATION_MUTATION } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
  // Admin impersonation: signing out ends everything — best-effort server-side
  // stop (the row is the revocation source of truth; TTL covers a failure),
  // then drop the impersonation cookie along with the session cookie.
  const impToken = cookies.get('hadron_impersonation');
  if (impToken) {
    try {
      await gqlClient(impToken).request(STOP_IMPERSONATION_MUTATION, {});
    } catch {
      // Expired/already-stopped — the TTL covers it.
    }
    cookies.delete('hadron_impersonation', { path: '/' });
  }
  cookies.delete('hadron_token', { path: '/' });
  redirect(303, '/');
};
