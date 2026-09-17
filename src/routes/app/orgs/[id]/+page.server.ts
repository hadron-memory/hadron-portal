import { fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { loadOrgDetail } from '$lib/server/org-detail';
import { extractGqlError } from '$lib/server/gqlError';
import { UPDATE_ORGANIZATION_MUTATION } from '$lib/server/queries';
import { parseDisplayUrn } from '$lib/urn/parse-urn';
import type { Actions, PageServerLoad } from './$types';
import { orgProfileSchema } from './schema';

const orgProfileFormAdapter = zod4(orgProfileSchema);

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
//
// #394: the Profile tab now shows the org's own properties and lets an
// org ADMIN/OWNER edit them (name, URN slug). `currentUserId` lets the page
// gate the Edit affordance to admins; the server enforces the real ADMIN check
// on the `update` action regardless. #609: the isVisible edit was removed — it
// is a system-managed listing flag, not a user-facing public/private toggle.
export const load: PageServerLoad = async ({ params, locals }) => {
  // #845: the layout carries chrome only; this tab needs the full org.
  const org = await loadOrgDetail(locals.token, params.id);
  const form = await superValidate(
    { name: org.name ?? '', urn: parseDisplayUrn(org.urn, 'org').bareValue },
    orgProfileFormAdapter,
    { errors: false },
  );
  return { org, currentUserId: locals.user?.id ?? null, form };
};

export const actions: Actions = {
  // #394: edit the org's core properties. Server-side updateOrganization is
  // ADMIN-gated and, when the URN changes, transactionally rewrites the
  // denormalized `<orgUrn>::…` prefix on every child Memory/Agent/App (#337) —
  // the portal just forwards the new values.
  update: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), orgProfileFormAdapter);
    if (!form.valid) return fail(400, { form });

    const name = form.data.name || undefined;
    // The server stores the BARE org slug; the denormalized `<orgUrn>::…`
    // prefix on child memory/agent/app urns is rebuilt from it on rename. If a
    // scheme-prefixed urn (e.g. `hrn:org:acme`) were stored as the org urn, the
    // cascade would corrupt every child (#394). Strip any scheme/type prefix to
    // the bare slug — parseDisplayUrn is idempotent on a bare value — then
    // VALIDATE it's a single slug atom. parseDisplayUrn alone is not enough: a
    // crafted input can still leave a `:`-bearing value (`hrn:org:acme::dev` →
    // `acme::dev`, or a bare `hrn:org:` that doesn't match the scheme regex),
    // which would again break the cascade. validateOrgSlug rejects any `:`,
    // bad charset, over-length, or reserved word, so we 400 instead of 500.
    const urnRaw = form.data.urn;
    let urn: string | undefined;
    if (urnRaw) {
      urn = parseDisplayUrn(urnRaw, 'org').bareValue;
    }
    try {
      await gqlClient(locals.token).request(UPDATE_ORGANIZATION_MUTATION, {
        id: params.id, name, urn,
      });
      return message(form, { type: 'success', text: 'Changes saved.' });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to update organization') }, { status: 500 });
    }
  },
};
