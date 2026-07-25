// #647: /app/agents is the org-less "My agents" list — the caller's OWN
// (user-owned, organizationId==null) agents. The analogue of /app/memories.
//
// It used to 302 to the active org's grid (spec 014 FR-008); that stranded an
// individual (org-less) user, who has no active org, and there was no route to
// their personal agents even though org-less agent create + detail shipped
// (#641). Org members still reach their org grid via the org-scoped nav item
// (/app/orgs/<id>/agents) — the nav points them there directly (src/lib/nav.ts),
// so no redirect hop is needed here.
import { fetchOwnedAgents } from '$lib/server/personal-agents';
import type { PersonalAgent } from '$lib/server/personal-agents';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  // A FAILED fetch is distinct from a genuinely empty list — silently showing the
  // empty state on an API error would hide existing agents
  // (conventions:no-silent-loader-catch). No requireNonConsumer: this IS the
  // individual-user surface, and the server's agents() list is the auth gate
  // (returns only the caller's own agents).
  const owned = await Promise.allSettled([fetchOwnedAgents(locals.token)]);
  const [agents] = owned;

  if (agents.status === 'rejected') {
    console.error('[my-agents] failed to load personal agents:', agents.reason);
  }

  return {
    agents: agents.status === 'fulfilled' ? agents.value : ([] as PersonalAgent[]),
    loadFailed: agents.status === 'rejected',
  };
};
