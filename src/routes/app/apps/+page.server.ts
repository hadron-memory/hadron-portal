// #647: /app/apps is the org-less "My apps" list — the caller's OWN (user-owned,
// organizationId==null) apps. The app analogue of /app/agents (#647) and
// /app/memories.
//
// It used to 302 to the active org's grid (spec 014 FR-008), which stranded an
// individual (org-less) user: they have no active org, yet spec 047 lets a user
// own an App directly (App.ownerUserId). Org members still reach their org grid
// via the org-scoped nav item (/app/orgs/<id>/apps).
import { fetchOwnedApps } from '$lib/server/personal-apps';
import type { PersonalApp } from '$lib/server/personal-apps';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  // A FAILED fetch is distinct from a genuinely empty list — never silently show
  // the empty state on an API error (conventions:no-silent-loader-catch). No
  // requireNonConsumer: this IS the individual-user surface, and the server's
  // apps() list is the auth gate (returns only the caller's own apps).
  const [apps] = await Promise.allSettled([fetchOwnedApps(locals.token)]);

  if (apps.status === 'rejected') {
    console.error('[my-apps] failed to load personal apps:', apps.reason);
  }

  return {
    apps: apps.status === 'fulfilled' ? apps.value : ([] as PersonalApp[]),
    loadFailed: apps.status === 'rejected',
  };
};
