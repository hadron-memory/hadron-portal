import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import type { Organization } from '$lib/types';

/**
 * Fetch ONE TAB's slice of the org (#845).
 *
 * ## Why the layout does not do this
 *
 * `/app/orgs/[id]/+layout.server.ts` fetches `ORG_CHROME_QUERY` — three scalars
 * — and nothing else. Every nested field on `Organization` is non-null in the
 * SDL (`members`, `memories`, `agents`, `subscriptions`, `exchangeConnections`
 * are all `[X!]!`) while `organization(ref:)` itself is nullable, so GraphQL
 * null propagation carries ANY nested resolver failure up to `organization`.
 * With the fat query on the layout, one list refusing nulled the org and the
 * layout's 404 replaced the whole org surface.
 *
 * ## Why `document` is a parameter rather than one shared query
 *
 * @codex's P1 on #847: moving the fat query DOWN is not containment if all five
 * tabs then share it. `exchangeConnections` refusing for a non-admin member
 * still took out Profile, Memories, Agents and Tasks along with Integrations,
 * because they all invoked that resolver to render lists they never show. Each
 * caller now passes the slice it actually renders (`ORG_PROFILE_QUERY`,
 * `ORG_MEMORIES_TAB_QUERY`, …), so a refusal reaches only the tab whose data it
 * is.
 *
 * ## What a failure does here
 *
 * `graphql-request` rejects on ANY GraphQL error, so a null-propagated org
 * arrives as a rejection carrying `data.organization === null` — it never
 * reaches a plain `if (!data.organization)` check (@copilot, same review; the
 * first version of this helper had exactly that bug and advertised a 404 while
 * returning a 500).
 *
 * So: a response that came back with a null org — whether cleanly or through a
 * rejection — is this tab's 404. Anything else (transport failure, a code this
 * route has no answer for) propagates as a 500, matching the layout's rule in
 * `+layout.server.ts`. Either way the chrome above survives, because
 * `+error.svelte` in this route renders INSIDE the org layout.
 */
export async function loadOrgDetail(
  token: string | null | undefined,
  ref: string,
  document: string,
): Promise<Organization> {
  // try/catch rather than a chained `.catch()`: one promise, awaited where it
  // is created. The chained form left a rejected promise briefly unattached,
  // which Node reports as an unhandled rejection and a test runner then blames
  // on whatever test is running — a failure that has nothing to do with the
  // behaviour under test and costs a long time to trace.
  let data: { organization: Organization | null };
  try {
    data = await gqlClient(token).request<{ organization: Organization | null }>(document, { ref });
  } catch (e: unknown) {
    // A rejection that still carried the org shape tells us which case this is.
    // `organization: null` beside an error is precisely the null-propagation
    // signature — the org resolved, one of ITS fields did not — and for this
    // tab that is indistinguishable from absent.
    const payload = (e as { response?: { data?: { organization?: Organization | null } } })
      ?.response?.data;
    if (payload && 'organization' in payload) {
      data = { organization: payload.organization ?? null };
    } else {
      // No org shape at all: either the org itself is the problem, or the
      // server is. Same allowlist the layout uses, so the two agree.
      const code = extractGqlErrorCode(e);
      if (code !== 'ORGANIZATION_NOT_FOUND' && code !== 'FORBIDDEN') throw e;
      data = { organization: null };
    }
  }

  if (!data.organization) throw error(404, 'Organization not found');
  return data.organization;
}
