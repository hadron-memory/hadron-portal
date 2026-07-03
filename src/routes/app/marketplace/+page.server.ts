import { fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import {
  PUBLIC_MEMORIES_QUERY,
  ADD_TO_MY_MEMORIES_MUTATION,
  ORGANIZATIONS_NAV_QUERY,
} from '$lib/server/queries';
import { filterToMemberOrgs, resolveActiveOrg } from '$lib/server/active-org';
import type { Memory, Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  try {
    const memories = await fetchAllItems<Memory>(gqlClient(), PUBLIC_MEMORIES_QUERY, 'memories');
    return { memories };
  } catch {
    return { memories: [] as Memory[] };
  }
};

export const actions: Actions = {
  addToMyMemories: async ({ request, locals }) => {
    const fd = await request.formData();
    const memoryId = String(fd.get('memoryId') ?? '');

    if (!locals.token) {
      redirect(303, `/signup?memory=${memoryId}`);
    }

    try {
      await gqlClient(locals.token).request(ADD_TO_MY_MEMORIES_MUTATION, { memoryId });
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
      redirect(303, activeOrgId ? `/app/orgs/${activeOrgId}/` : '/app/orgs/');
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'status' in e) throw e;
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to add memory' });
    }
  },
};
