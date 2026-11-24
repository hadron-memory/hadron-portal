import { gqlClient } from '$lib/server/api';
import { USAGE_EVENTS_QUERY } from '$lib/server/queries';
import type { UsageEvent } from '$lib/components/table/usageEvent';
import { isCapped } from '$lib/server/capped';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 200;

// #266 Usage tab — per-memory usage events. The server's `memoryRef` filter
// (hadron-server #249) is FK-precise and access-scoped: it returns [] if the
// caller can't read this memory, so no extra guard is needed here.
export const load: PageServerLoad = async ({ params, locals }) => {
  const data = await gqlClient(locals.token).request<{ usageEvents: UsageEvent[] }>(
    USAGE_EVENTS_QUERY,
    { memoryRef: params.id, limit: PAGE_SIZE },
  );

  return { events: data.usageEvents, eventsCapped: isCapped(data.usageEvents.length, PAGE_SIZE) };
};
