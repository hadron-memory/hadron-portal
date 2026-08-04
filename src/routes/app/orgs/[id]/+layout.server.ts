import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { ORGANIZATION_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { LayoutServerLoad } from './$types';

// #336: org-detail is a tab layout (mirrors /app/memories/[id]). The layout
// renders the breadcrumb + header + tab bar; each tab is a sub-route rendered
// via {@render children()}. The org is loaded here so the header/tabs have it
// on every tab without each page re-fetching it for chrome.
//
// NOTE: `requireNonConsumer` is intentionally NOT applied here. The Profile
// tab (the index page) IS the dashboard, and guards.ts redirects consumer-mode
// users to `/app/orgs/<activeOrgId>/` — applying the guard would loop. The
// admin-only sub-routes keep their own guard.
export const load: LayoutServerLoad = async ({ params, locals }) => {
  const data = await gqlClient(locals.token)
    .request<{ organization: Organization | null }>(ORGANIZATION_QUERY, { ref: params.id })
    .catch(() => {
      throw error(404, 'Organization not found');
    });

  if (!data.organization) throw error(404, 'Organization not found');
  return { org: data.organization };
};
