import { gqlClient } from '$lib/server/api';
import { USAGE_EVENTS_QUERY } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 20;

interface UsageEventRow {
  id: string;
  type: string;
  nodeLoc: string | null;
  stationId: string | null;
  sessionId: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  createdAt: string;
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const pageNum = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const typeFilter = url.searchParams.get('type') ?? undefined;
  const offset = (pageNum - 1) * PAGE_SIZE;

  const data = await gqlClient(locals.token).request<{ usageEvents: UsageEventRow[] }>(
    USAGE_EVENTS_QUERY,
    { limit: PAGE_SIZE + 1, offset, type: typeFilter },
  );

  const hasMore = data.usageEvents.length > PAGE_SIZE;
  const events = hasMore ? data.usageEvents.slice(0, PAGE_SIZE) : data.usageEvents;

  return { events, pageNum, hasMore, typeFilter: typeFilter ?? null };
};
