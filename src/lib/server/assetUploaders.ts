// Shared uploader-name resolution for the two Files surfaces.
//
// Both the per-memory Files tab and the top-level Files section need to turn
// `Asset.uploadedBy` (a User id) into something a human recognises, and both had
// their own copy of this — the cap, the NULL handling and the failure behaviour
// are all easy to let drift apart (PR #704 review, Copilot).

import { USER_PROFILE_QUERY } from '$lib/server/queries';
import type { GraphQLClient } from 'graphql-request';

/**
 * Cap on lookups, so a wide window can't fan out unboundedly. Uploaders repeat
 * heavily in practice (a memory usually has one or two), so the distinct count is
 * far below the row count and this rarely bites.
 */
export const MAX_UPLOADER_LOOKUPS = 25;

/** Just the field this needs, so either surface's asset type satisfies it. */
export interface HasUploader {
  uploadedBy: string | null;
}

/**
 * Resolve distinct uploader ids to `@handle`, keyed by id.
 *
 * Three deliberate behaviours, all of which a naive version gets wrong:
 *
 * - **NULL uploaders are never looked up.** A server-authored asset
 *   (`hadron_store_file` with no on-behalf-of user) has no user to resolve, and
 *   that is a normal case rather than missing data — the caller labels it.
 * - **An unresolved id is expected, not an error.** `user(ref:)` returns null when
 *   the caller may not see that user; denied and missing are indistinguishable by
 *   design, so the id is simply left out and the grid falls back to showing it.
 * - **One failed lookup never blanks the list.** Each is caught individually, so a
 *   single bad id can't cost the caller their whole page of files.
 */
export async function resolveUploaderNames(
  client: GraphQLClient,
  assets: readonly HasUploader[],
): Promise<Record<string, string>> {
  const ids = [...new Set(assets.map((a) => a.uploadedBy).filter((id): id is string => !!id))];
  const names: Record<string, string> = {};

  await Promise.all(
    ids.slice(0, MAX_UPLOADER_LOOKUPS).map(async (id) => {
      try {
        const d = await client.request<{ user: { id: string; handle: string | null } | null }>(
          USER_PROFILE_QUERY,
          { ref: id },
        );
        if (d.user?.handle) names[id] = `@${d.user.handle}`;
      } catch (err) {
        console.warn('[assets] uploader lookup failed for', id, err);
      }
    }),
  );

  return names;
}
