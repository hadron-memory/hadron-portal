import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { ORGANIZATION_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';

/**
 * The FULL org detail, for a tab that needs one of its nested lists (#845).
 *
 * ## Why this is not on the layout
 *
 * `/app/orgs/[id]/+layout.server.ts` fetches `ORG_CHROME_QUERY` — three scalars
 * — and nothing else. Every nested field on `Organization` is non-null in the
 * SDL (`members`, `memories`, `agents`, `subscriptions`, `exchangeConnections`
 * are all `[X!]!`) while `organization(ref:)` itself is nullable, so GraphQL
 * null propagation carries ANY nested resolver failure up to `organization`.
 * With the fat query on the layout, one list refusing — `exchangeConnections`
 * for a non-admin member, say — nulled the org and the layout's 404 replaced
 * the whole org surface, every tab, for someone looking at their own org.
 *
 * Moving the fat query down here does not make that propagation go away; it
 * CONTAINS it. A list failure now takes out the tab that asked for the list,
 * and the breadcrumb, header and tab bar keep rendering from the layout's
 * scalars, so the reader can still navigate to the tabs that work.
 *
 * ## On the second query
 *
 * #842 removed a duplicate `ORGANIZATION_QUERY` from these loaders, which is
 * the change this partially walks back — so it is worth being precise about
 * what it costs. #842 was removing a SECOND COPY of the same fat query. Here
 * the layout's query is three scalars, so a tab that needs the detail issues
 * one fat query and one trivial one, where before #842 it issued two fat ones.
 * The tabs that need NO list (apps, runs, sessions, ai-configs) are strictly
 * better off than under #842: they now load the chrome alone rather than every
 * member, memory, agent, subscription and exchange connection the org has.
 *
 * The direction that removes the remaining fat query is per-tab ROOT list
 * queries (`memories(orgId:)`, `agents(orgId:)`) instead of reaching through
 * `organization`, which also makes them paginable. Out of scope here; #845
 * records it.
 */
export async function loadOrgDetail(
  token: string | null | undefined,
  ref: string,
): Promise<Organization> {
  const data = await gqlClient(token).request<{ organization: Organization | null }>(
    ORGANIZATION_QUERY,
    { ref },
  );
  // The layout has already resolved this same ref and raised its own 404/500 by
  // the time a page load runs, so reaching a null here means the org went away
  // between the two requests, or a nested list failed and propagated. Either
  // way this tab has nothing to render.
  if (!data.organization) throw error(404, 'Organization not found');
  return data.organization;
}
