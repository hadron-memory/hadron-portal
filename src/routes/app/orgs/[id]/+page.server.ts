import type { PageServerLoad } from './$types';

// #336: this page is the Profile tab of the org-detail tab layout (the
// dashboard landing). The org (incl. 404 handling) is already loaded by
// +layout.server.ts; pull it from parent() rather than re-issuing
// ORGANIZATION_QUERY.
//
// Spec 014 D7: this page IS the dashboard. requireNonConsumer is not applied
// (guards.ts redirects consumer-mode users here; applying the guard would
// loop). GitHub / Exchange / AI-config management moved to the Integrations
// tab (#336).
//
// #364: the Memories/Agents/Apps quick-stat cards were removed from this page,
// so APPS_QUERY (the apps-count overfetch, originally spec 015) is gone too.
export const load: PageServerLoad = async ({ parent }) => {
  const { org } = await parent();
  return { org };
};
