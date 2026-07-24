import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { requireNonConsumer } from '$lib/server/guards';
import { ORGANIZATIONS_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
  await requireNonConsumer(parent);
  // #627 removed the per-user "personal org" (and the `isVisible` flag that
  // hid it), so the manage-orgs list no longer needs to filter anything out —
  // every org the server returns is a real, member/admin-facing org.
  const orgs = await fetchAllItems<Organization>(gqlClient(locals.token), ORGANIZATIONS_QUERY, 'organizations');
  return { orgs };
};
