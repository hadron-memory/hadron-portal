// #629: /app/dashboard is the individual user's stats page. Org members keep the
// spec-014 behavior — a 302 to their org overview (their dashboard) — while
// consumer / org-less users get simple stats about their own workspace instead
// of being sent into the phantom personal org.
import { redirect } from '@sveltejs/kit';
import { fetchOwnedMemories } from '$lib/server/personal-memories';
import type { Memory } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
  const { activeOrgId, isConsumerMode } = await parent();

  // Org members: preserve the redirector to their org overview page.
  if (!isConsumerMode && activeOrgId) {
    redirect(302, `/app/orgs/${activeOrgId}/`);
  }

  // Consumer / org-less: simple stats about the memories they own. Surface a
  // failed fetch rather than silently reporting "0 memories"
  // (conventions:no-silent-loader-catch).
  try {
    return { memories: await fetchOwnedMemories(locals.token), loadFailed: false };
  } catch (e) {
    console.error('[dashboard] failed to load memories:', e);
    return { memories: [] as Memory[], loadFailed: true };
  }
};
