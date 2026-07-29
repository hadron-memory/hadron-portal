// Usage tab chart mode: this memory's read/write activity, bucketed by day.
// A client-fetched endpoint (not part of the tab's server load) for two
// reasons: the browser's IANA time zone must reach the server so days bucket
// on the user's calendar, and window changes should swap data without a page
// reload. Access control is the server query's: an unreadable memory yields
// empty buckets, indistinguishable from a quiet one.
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { USAGE_ACTIVITY_QUERY } from '$lib/server/queries';
import type { RequestHandler } from './$types';

const WINDOW_OPTIONS = [7, 14, 30, 90];

interface Bucket {
  date: string;
  reads: number;
  writes: number;
}

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const rawWindow = Number(url.searchParams.get('window'));
  const windowDays = WINDOW_OPTIONS.includes(rawWindow) ? rawWindow : 30;
  const tz = url.searchParams.get('tz') ?? 'UTC';

  const to = new Date();
  const from = new Date(to.getTime() - windowDays * 86_400_000);
  try {
    const data = await gqlClient(locals.token).request<{ usageActivity: Bucket[] }>(
      USAGE_ACTIVITY_QUERY,
      {
        from: from.toISOString(),
        to: to.toISOString(),
        memoryRefs: [params.id],
        timeZone: tz,
      },
    );
    return json({ windowDays, timeZone: tz, buckets: data.usageActivity, loadFailed: false });
  } catch (e) {
    // An unknown zone (or transient failure) degrades this fetch, not the tab —
    // the page shows an explicit error state and the table stays available.
    console.error('[memories/usage/activity] failed to load:', e);
    return json({ windowDays, timeZone: tz, buckets: [], loadFailed: true }, { status: 200 });
  }
};
