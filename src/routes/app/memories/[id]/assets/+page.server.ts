import { gqlClient } from '$lib/server/api';
import { MEMORY_ASSETS_QUERY } from '$lib/server/assetQueries';
import { resolveUploaderNames } from '$lib/server/assetUploaders';
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

  return {
    assets: page.assets,
    total: page.total,
    truncated: page.hasMore,
    failed: false,
    // Shared with the top-level Files section — the cap, the NULL-uploader skip
    // and the per-id failure isolation all have to match, and two copies of that
    // drift (PR #704 review, Copilot).
    uploaderNames: await resolveUploaderNames(client, page.assets),
  };
};
