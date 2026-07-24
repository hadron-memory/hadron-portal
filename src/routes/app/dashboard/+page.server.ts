// #629: /app/dashboard is the stats page for EVERY user (an org page is the
// wrong content for a dashboard). For now it shows simple stats about the
// memories the user owns; org-scoped stats + activity charts are a follow-up.
import { fetchOwnedMemories } from '$lib/server/personal-memories';
import type { Memory } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  // Surface a failed fetch rather than silently reporting "0 memories"
  // (conventions:no-silent-loader-catch).
  try {
    return { memories: await fetchOwnedMemories(locals.token), loadFailed: false };
  } catch (e) {
    console.error('[dashboard] failed to load memories:', e);
    return { memories: [] as Memory[], loadFailed: true };
  }
};
