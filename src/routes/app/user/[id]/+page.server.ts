import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { USER_PROFILE_QUERY } from '$lib/server/queries';
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
 * empty shape (findings:page-server-silent-catch): a transient GraphQL failure
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

  return { user };
};
