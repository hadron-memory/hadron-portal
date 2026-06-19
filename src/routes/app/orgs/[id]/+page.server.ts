import { gqlClient } from '$lib/server/api';
import { APPS_QUERY } from '$lib/server/queries';
import type { App } from '$lib/types';
import type { PageServerLoad } from './$types';

function extractGqlError(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const resp = (e as { response: { errors?: { message: string }[] } }).response;
    if (resp.errors?.[0]?.message) return resp.errors[0].message;
  }
  return e instanceof Error ? e.message : fallback;
}

// #336: this page is the Profile tab of the org-detail tab layout (the
// dashboard landing). The org (incl. 404 handling) is already loaded by
// +layout.server.ts; pull it from parent() rather than re-issuing
// ORGANIZATION_QUERY. Apps are NOT in ORGANIZATION_QUERY (shared by ~10 routes
// that would overfetch APP_FIELDS), so APPS_QUERY runs here for the apps stat —
// failure surfaced inline (FR-006).
//
// Spec 014 D7: this page IS the dashboard. requireNonConsumer is not applied
// (guards.ts redirects consumer-mode users here; applying the guard would
// loop). GitHub / Exchange / AI-config management moved to the Integrations
// tab (#336).
export const load: PageServerLoad = async ({ params, locals, parent }) => {
  const { org } = await parent();
  try {
    const appsResult = await gqlClient(locals.token).request<{ apps: App[] }>(APPS_QUERY, { orgId: params.id });
    return { org, apps: appsResult.apps, appsError: null };
  } catch (e: unknown) {
    return { org, apps: [] as App[], appsError: extractGqlError(e, 'Failed to load apps') };
  }
};
