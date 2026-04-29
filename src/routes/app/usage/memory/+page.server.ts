import { gqlClient } from '$lib/server/api';
import { USAGE_EVENTS_QUERY } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 200;

interface UsageEventRow {
  id: string;
  type: string;
  nodeLoc: string | null;
  appId: string | null;
  sessionId: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  createdAt: string;
}

export const load: PageServerLoad = async ({ locals }) => {
  const data = await gqlClient(locals.token).request<{ usageEvents: UsageEventRow[] }>(
    USAGE_EVENTS_QUERY,
    { limit: PAGE_SIZE },
  );

  return { events: data.usageEvents };
};
