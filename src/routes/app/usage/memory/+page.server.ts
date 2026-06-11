import { gqlClient } from '$lib/server/api';
import { USAGE_EVENTS_QUERY } from '$lib/server/queries';
import type { UsageEvent } from '$lib/components/table/usageEvent';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 200;

export const load: PageServerLoad = async ({ locals }) => {
  const data = await gqlClient(locals.token).request<{ usageEvents: UsageEvent[] }>(
    USAGE_EVENTS_QUERY,
    { limit: PAGE_SIZE },
  );

  return { events: data.usageEvents };
};
