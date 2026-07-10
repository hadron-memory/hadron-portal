import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { requireNonConsumer } from '$lib/server/guards';
import { ORGANIZATIONS_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
  await requireNonConsumer(parent);
  const all = await fetchAllItems<Organization>(gqlClient(locals.token), ORGANIZATIONS_QUERY, 'organizations');
  // `isVisible` is an owner-facing UI flag: a personal org is created hidden
  // (`false`) and is only surfaced once the user activates org mode (creates or
  // converts an org → `true`). The manage-orgs list shows only activated orgs;
  // hidden personal orgs (`isVisible !== true`) are excluded, mirroring
  // consumer-mode detection in `+layout.server.ts`.
  const orgs = all.filter((o) => o.isVisible === true);
  return { orgs };
};
