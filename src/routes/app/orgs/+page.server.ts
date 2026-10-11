import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { ORGANIZATIONS_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { PageServerLoad } from './$types';

// #1062: NO `requireNonConsumer` here. A user in no organization is in
// "consumer mode", and that guard sent them to My memories when they chose
// "View organizations" — the same fault #1028 fixed on the create form. The
// list is the page that shows them the empty state and the way to create one;
// the server returns only what they may see, which for them is nothing.
export const load: PageServerLoad = async ({ locals }) => {
  // #627 removed the per-user "personal org" (and the `isVisible` flag that
  // hid it), so the manage-orgs list no longer needs to filter anything out —
  // every org the server returns is a real, member/admin-facing org.
  const orgs = await fetchAllItems<Organization>(gqlClient(locals.token), ORGANIZATIONS_QUERY, 'organizations');
  return { orgs };
};
