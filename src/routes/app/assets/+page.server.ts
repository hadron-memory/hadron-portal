import { gqlClient } from '$lib/server/api';
import { ASSETS_QUERY } from '$lib/server/assetQueries';
import { USER_PROFILE_QUERY } from '$lib/server/queries';
import { ALL_ASSETS_DEP } from '$lib/assets/deps';
import { assetQueryArgs, parseAssetTab } from '$lib/assets/tabs';
// Type-only, so the client helper module never enters the server bundle.
import type { AssetSummary } from '$lib/api/assetUpload';
import type { GraphQLClient } from 'graphql-request';
import type { PageServerLoad } from './$types';

/**
 * How many rows the grid gets. It filters, sorts and pages CLIENT-side over this
 * window, so the window is the real limit and `truncated` says so out loud when
 * it bites — a silent cap reads as "that's everything".
 *
 * Deliberately a bounded window rather than paging to completion: "Available
 * files" spans every memory the caller can read, which for a marketplace-
 * connected account is unbounded in principle.
 */
const WINDOW = 500;

/**
 * hadron-server caps the uniform list's `limit` at 200 (spec cor:api:120), so a
 * single request for WINDOW would be silently CLAMPED, not honoured. Page
 * explicitly instead.
 */
const PAGE = 200;

/** Cap on uploader lookups, so a wide window can't fan out unboundedly. */
const MAX_UPLOADER_LOOKUPS = 25;

async function fetchWindow(
  client: GraphQLClient,
  args: { filter?: { mine?: boolean }; orgId?: string },
): Promise<{ items: AssetSummary[]; total: number }> {
  const items: AssetSummary[] = [];
  let total = 0;
  for (let offset = 0; offset < WINDOW; offset += PAGE) {
    const data = await client.request<{ assets: { items: AssetSummary[]; total: number } }>(
      ASSETS_QUERY,
      { ...args, limit: Math.min(PAGE, WINDOW - offset), offset },
    );
    const page = data.assets;
    total = page.total;
    items.push(...page.items);
    // Stop on a short page too, so a shrinking or missing total can't loop.
    if (page.items.length < PAGE || items.length >= total) break;
  }
  return { items, total };
}

/**
 * Resolve uploader ids to handles so the grid shows a person, not a cuid.
 *
 * NULL uploaders are never looked up — a server-authored asset
 * (`hadron_store_file` with no on-behalf-of user) has no user to resolve, and
 * that is a normal case, not missing data.
 */
async function resolveUploaders(
  client: GraphQLClient,
  assets: AssetSummary[],
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
        // `user(ref:)` returns null when the caller may not see that user —
        // denied and missing are indistinguishable by design — so an unresolved
        // id is expected and the grid falls back to showing the id.
        if (d.user?.handle) names[id] = `@${d.user.handle}`;
      } catch (err) {
        // One unresolvable uploader must not blank the whole list.
        console.warn('[assets] uploader lookup failed for', id, err);
      }
    }),
  );
  return names;
}

// portal#696 part 1 — the top-level Files section: My / Available / Org, over
// hadron-server#895's uniform cross-memory `assets()` query.
export const load: PageServerLoad = async ({ url, locals, parent, depends }) => {
  depends(ALL_ASSETS_DEP);

  // Resolve the parent FIRST, on its own. Overlapping parent() with the fetches
  // in one Promise.all would let a fetch rejection surface before the layout's
  // own guards ran (review:guard-runs-before-fetch-errors).
  const { activeOrgId } = (await parent()) as { activeOrgId?: string | null };

  const tab = parseAssetTab(url.searchParams.get('tab'));
  const args = assetQueryArgs(tab, activeOrgId);

  // `org` with no active org: NOT a query. Falling through to the default scope
  // would return everything the caller can reach and label it "this
  // organization's".
  if (!args) {
    return {
      tab,
      assets: [],
      total: 0,
      truncated: false,
      failed: false,
      noOrg: true,
      uploaderNames: {},
    };
  }

  const client = gqlClient(locals.token);
  try {
    const page = await fetchWindow(client, args);
    return {
      tab,
      assets: page.items,
      total: page.total,
      truncated: page.items.length < page.total,
      failed: false,
      noOrg: false,
      uploaderNames: await resolveUploaders(client, page.items),
    };
  } catch (err) {
    // Surface the failure rather than swallowing it
    // (review:no-silent-loader-catch): an empty list alone is indistinguishable
    // from "you have no files", and that ambiguity has masked real server errors
    // in this repo before.
    console.error('[assets] assets query failed:', err);
    return {
      tab,
      assets: [],
      total: 0,
      truncated: false,
      failed: true,
      noOrg: false,
      uploaderNames: {},
    };
  }
};
