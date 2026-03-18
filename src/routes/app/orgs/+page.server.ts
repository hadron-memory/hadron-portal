import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { MY_ORGANIZATIONS_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
  await requireNonConsumer(parent);
  const data = await gqlClient(locals.token).request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY);
  return { orgs: data.myOrganizations };
};
