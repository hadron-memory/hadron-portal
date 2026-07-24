// #629: /app/dashboard is the stats page for EVERY user (an org page is the
// wrong content for a dashboard). For now it shows simple stats about the
// memories the user owns; org-scoped stats + activity charts are a follow-up.
import { gqlClient } from '$lib/server/api';
import { DASHBOARD_MEMORIES_QUERY } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

export interface DashboardMemory {
  id: string;
  name: string;
  urn: string;
  class: string;
}

export const load: PageServerLoad = async ({ locals }) => {
  // Bounded, slim query — a count + a five-item preview, not the whole memory
  // set (review: don't fetchAllItems just for a count). Surface a failed fetch
  // rather than silently reporting "0 memories" (conventions:no-silent-loader-catch).
  try {
    const data = await gqlClient(locals.token).request<{
      memories: { items: DashboardMemory[]; total: number };
    }>(DASHBOARD_MEMORIES_QUERY);
    return { memoryCount: data.memories.total, preview: data.memories.items, loadFailed: false };
  } catch (e) {
    console.error('[dashboard] failed to load stats:', e);
    return { memoryCount: 0, preview: [] as DashboardMemory[], loadFailed: true };
  }
};
