import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { ORGANIZATION_QUERY, APPS_QUERY } from '$lib/server/queries';
import type { Organization, App } from '$lib/types';
import type { PageServerLoad } from './$types';

function extractGqlError(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const resp = (e as { response: { errors?: { message: string }[] } }).response;
    if (resp.errors?.[0]?.message) return resp.errors[0].message;
  }
  return e instanceof Error ? e.message : fallback;
}

// #336: this page is the Profile tab of the org-detail tab layout (the
// dashboard landing). The org is also loaded by +layout.server.ts for the
// header/tabs; it's re-fetched here so the load result keeps a self-contained
// shape and a missing org 404s on the page too. Apps are not in
// ORGANIZATION_QUERY (shared by ~10 routes that would overfetch APP_FIELDS),
// so APPS_QUERY runs in parallel for the apps stat — surfaced inline (FR-006).
//
// Spec 014 D7: this page IS the dashboard. requireNonConsumer is not applied
// (guards.ts redirects consumer-mode users here; applying the guard would
// loop). GitHub / Exchange / AI-config management moved to the Integrations
// tab (#336).
export const load: PageServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);

  // Fire both in parallel; attach a no-op catch on apps so an early org
  // throw doesn't leave the apps promise as an unhandled rejection.
  const appsPromise = client.request<{ apps: App[] }>(APPS_QUERY, { orgId: params.id });
  appsPromise.catch(() => { /* result inspected below */ });

  let orgResult: { organization: Organization | null };
  try {
    orgResult = await client.request<{ organization: Organization | null }>(ORGANIZATION_QUERY, { id: params.id });
  } catch {
    throw error(404, 'Organization not found');
  }
  if (!orgResult.organization) throw error(404, 'Organization not found');

  try {
    const appsResult = await appsPromise;
    return { org: orgResult.organization, apps: appsResult.apps, appsError: null };
  } catch (e: unknown) {
    return {
      org: orgResult.organization,
      apps: [] as App[],
      appsError: extractGqlError(e, 'Failed to load apps'),
    };
  }
};
