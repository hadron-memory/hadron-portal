import { fail, isRedirect, redirect } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import {
  MARKETPLACE_QUERY,
  ADD_TO_MY_MEMORIES_MUTATION,
  ORGANIZATIONS_NAV_QUERY,
} from '$lib/server/queries';
import { filterToMemberOrgs, resolveActiveOrg } from '$lib/server/active-org';
import type { Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { addMarketplaceMemorySchema } from './schema';

const addMarketplaceMemoryFormAdapter = zod4(addMarketplaceMemorySchema);
type AddMarketplaceMemoryForm = Infer<typeof addMarketplaceMemorySchema, 'zod4'>;

/** A sanitized marketplace ref (cor:acl:080:02/04). */
export interface MarketplaceRef {
  id: string;
  name: string;
  urn: string;
  description: string | null;
}
interface MarketplaceSection {
  items: MarketplaceRef[];
  total: number;
}
const EMPTY: MarketplaceSection = { items: [], total: 0 };

// cor:acl:080:04 — browse the marketplace catalogue (listedOnMarketplace +
// publicly accessible orgs / agents / memories). Public; a token is forwarded
// when present but the server queries require no membership. Loads the first
// page of each section.
export const load: PageServerLoad = async ({ locals }) => {
  const form = await superValidate<AddMarketplaceMemoryForm>(
    { memoryId: '' },
    addMarketplaceMemoryFormAdapter,
    { errors: false },
  );

  try {
    const data = await gqlClient(locals.token).request<{
      marketplaceOrganizations: MarketplaceSection;
      marketplaceAgents: MarketplaceSection;
      marketplaceMemories: MarketplaceSection;
    }>(MARKETPLACE_QUERY, { limit: 60 });
    return {
      organizations: data.marketplaceOrganizations,
      agents: data.marketplaceAgents,
      memories: data.marketplaceMemories,
      form,
    };
  } catch {
    return { organizations: EMPTY, agents: EMPTY, memories: EMPTY, form };
  }
};

export const actions: Actions = {
  addToMyMemories: async ({ request, locals }) => {
    const form = await superValidate<AddMarketplaceMemoryForm>(
      await request.formData(),
      addMarketplaceMemoryFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    if (!locals.token) {
      redirect(303, `/signup?memory=${encodeURIComponent(form.data.memoryId)}`);
    }

    try {
      await gqlClient(locals.token).request(ADD_TO_MY_MEMORIES_MUTATION, {
        memoryId: form.data.memoryId,
      });
      // Resolve the active org and redirect straight to /app/orgs/<id>/
      // to avoid the /app/dashboard 303→302 chain. One extra GQL call
      // server-side is cheaper than a full browser redirect hop.
      const orgs = await fetchAllItems<Organization>(gqlClient(locals.token), ORGANIZATIONS_NAV_QUERY, 'organizations')
        .catch(() => [] as Organization[]);
      // hadron-server#473: resolve against memberships only — the nav query
      // is server-filtered (filter.memberOnly, admins included);
      // filterToMemberOrgs stays as defense-in-depth.
      const { activeOrgId } = resolveActiveOrg({
        paramsId: undefined,
        lastActiveOrgId: null,
        myOrganizations: filterToMemberOrgs(orgs, locals.user?.id),
      });
      // No org (an org-less individual, post-#627) → their memories surface,
      // NOT `/app/orgs/`, which would bounce them back off requireNonConsumer.
      redirect(303, activeOrgId ? `/app/orgs/${activeOrgId}/` : '/app/memories');
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      return message(
        form,
        { type: 'error', text: e instanceof Error ? e.message : 'Failed to add memory' },
        { status: 500 },
      );
    }
  },
};
