import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { fetchAllItems } from '$lib/server/paginate';
import { HELD_WORKERS_QUERY, USER_PROFILE_QUERY } from '$lib/server/queries';
import type { HeldWorker } from '$lib/components/HeldWorkersTable.svelte';
import type { PageServerLoad } from './$types';

/**
 * #533 — public user profile page. Shows the target user's public identifiers
 * (avatar + handle). `params.id` is passed to the server's `user(ref:)` read
 * verbatim, which accepts a PK or a `hrn:user:<handle>` URN.
 *
 * Access + existence-hiding live entirely in the server resolver: it returns
 * null both for a nonexistent user and for one the caller can't reach (not
 * self / admin / co-member), so a no-access id 404s exactly like a missing one
 * — no enumeration signal. We deliberately do NOT `.catch` the request into an
 * empty shape (hrn:node:hadronmemory.com:hadron-portal:findings:page-server-silent-catch): a transient GraphQL failure
 * must surface as a 500, distinct from a legitimate not-found.
 */
type PublicUser = {
  id: string;
  handle: string | null;
  urn: string | null;
  githubUsername: string | null;
  avatarUrl: string | null;
};

export const load: PageServerLoad = async ({ params, locals }) => {
  const { user } = await gqlClient(locals.token).request<{ user: PublicUser | null }>(
    USER_PROFILE_QUERY,
    { ref: params.id },
  );

  if (!user) throw error(404, 'User not found, or you do not have access to it.');

  return { user, heldWorkers: await loadHeldWorkers(locals.token, user.id) };
};

type HeldWorkersResult = { ok: true; items: HeldWorker[] } | { ok: false; detail: string };

/**
 * #919 — the Workers tab. Selected by the resolved user's id, never the URL
 * ref, and paged to COMPLETION (`fetchAllItems`): the server caps a page at
 * 200 and orders oldest-first, so one request left every newer worker
 * unreachable by the grid (@codex on #930). A failed read is REPORTED on the
 * tab (`ok: false`), not folded into an empty roster that would claim the user
 * holds nothing (hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch);
 * the profile itself still renders.
 */
async function loadHeldWorkers(token: string | null | undefined, userId: string): Promise<HeldWorkersResult> {
  try {
    const items = await fetchAllItems<HeldWorker>(gqlClient(token), HELD_WORKERS_QUERY, 'heldWorkers', { userRef: userId });
    return { ok: true, items };
  } catch (e) {
    console.error('[user profile] heldWorkers failed:', e);
    return { ok: false, detail: extractGqlError(e, 'The workers could not be loaded') };
  }
}
