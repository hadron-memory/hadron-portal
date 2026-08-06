import { gqlClient } from '$lib/server/api';
import { MEMORY_ASSETS_QUERY } from '$lib/server/assetQueries';
import { USER_PROFILE_QUERY } from '$lib/server/queries';
import { MEMORY_ASSETS_DEP } from '$lib/assets/deps';
// Type-only import, so the client helper module itself is never pulled into the
// server bundle.
import type { AssetSummary } from '$lib/api/assetUpload';
import type { PageServerLoad } from './$types';

/**
 * One window of assets. `memoryAssets` is access-scoped on the holding memory's
 * READ gate (hadron-server#888 — it used to filter `uploadedBy = caller`), so no
 * extra guard is needed here: a caller who can't read this memory can't reach
 * the layout either.
 *
 * The grid filters/sorts/pages client-side over this window, so it is sized well
 * above a realistic per-memory file count rather than paged. `truncated` says so
 * out loud when the window clips — a silent cap would read as "that's all of
 * them".
 */
const WINDOW = 500;

/** Cap on uploader lookups, so a wide window can't fan out unboundedly. */
const MAX_UPLOADER_LOOKUPS = 25;

export const load: PageServerLoad = async ({ params, locals, depends }) => {
  // Lets the page re-run JUST this loader after an upload or a delete.
  depends(MEMORY_ASSETS_DEP);
  const client = gqlClient(locals.token);

  let page: { assets: AssetSummary[]; total: number; hasMore: boolean };
  try {
    const data = await client.request<{
      memoryAssets: { assets: AssetSummary[]; total: number; hasMore: boolean };
    }>(MEMORY_ASSETS_QUERY, { memoryId: params.id, skip: 0, count: WINDOW });
    page = data.memoryAssets;
  } catch (err) {
    // Surface the failure instead of swallowing it (review:no-silent-loader-catch):
    // an empty `assets` alone is indistinguishable from a memory with no files,
    // and that ambiguity has masked real server errors in this repo before.
    console.error('[memory-assets] memoryAssets failed:', err);
    return { assets: [], total: 0, truncated: false, failed: true, uploaderNames: {} };
  }

  // `uploadedBy` is a User id; resolve the distinct ones to handles so the grid
  // shows a person, not a cuid. NULL uploaders (server-authored, hadron_store_file)
  // are not looked up — they have no user to resolve.
  const uploaderIds = [...new Set(page.assets.map((a) => a.uploadedBy).filter((id): id is string => !!id))];
  const looked = uploaderIds.slice(0, MAX_UPLOADER_LOOKUPS);

  const uploaderNames: Record<string, string> = {};
  await Promise.all(
    looked.map(async (id) => {
      try {
        const d = await client.request<{ user: { id: string; handle: string | null } | null }>(
          USER_PROFILE_QUERY,
          { ref: id },
        );
        // `user(ref:)` returns null when the caller may not see that user (not
        // a co-member, not an admin) — denied and missing are indistinguishable
        // by design. Leaving the id unresolved is the correct outcome, and the
        // grid falls back to showing the id.
        if (d.user?.handle) uploaderNames[id] = `@${d.user.handle}`;
      } catch (err) {
        // One unresolvable uploader must not blank the whole file list.
        console.warn('[memory-assets] uploader lookup failed for', id, err);
      }
    }),
  );

  return {
    assets: page.assets,
    total: page.total,
    truncated: page.hasMore,
    failed: false,
    uploaderNames,
  };
};
