import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import type { Organization } from '$lib/types';

/**
 * Fetch ONE CALLER's slice of the org, classifying a failure instead of
 * collapsing it (#845, widened by #851).
 *
 * Two kinds of caller use this, and the difference is worth knowing because it
 * decides what the allowlist below may contain:
 *
 *   - **an org-detail TAB**, whose `ref` is `params.id` — a user-supplied route
 *     param. A malformed one is caller error, but the tab never sees it:
 *     `/app/orgs/[id]/+layout.server.ts` runs first and answers the ref-shape
 *     codes (`URN_NOT_QUALIFIED`, `BAD_USER_INPUT`) with its own 404.
 *   - **an App detail page** (#851), whose `ref` is `app.organizationId` — an id
 *     the SERVER handed us. There is no layout in front of it, and a ref-shape
 *     refusal on a server-supplied id is a server fault, not caller error.
 *
 * Both land on the same two-code allowlist, for opposite reasons: for a tab
 * because the layout already spent the other codes, for an App page because the
 * other codes would be lies about the caller. Do not widen it to match the
 * layout's four — that set is specifically about a ref a human typed.
 *
 * ## Why the org layout does not do this
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
export async function loadOrgDetail<T = Organization>(
  token: string | null | undefined,
  ref: string,
  document: string,
): Promise<T> {
  // try/catch rather than a chained `.catch()`: one promise, awaited where it
  // is created. The chained form left a rejected promise briefly unattached,
  // which Node reports as an unhandled rejection and a test runner then blames
  // on whatever test is running — a failure that has nothing to do with the
  // behaviour under test and costs a long time to trace.
  let data: { organization: T | null };
  try {
    data = await gqlClient(token).request<{ organization: T | null }>(document, { ref });
  } catch (e: unknown) {
    const payload = (e as { response?: { data?: { organization?: T | null } } })?.response?.data;

    // A rejection that still carried a USABLE org is a partial success: some
    // nullable field failed without propagating, and erroring the tab over it
    // would throw away a page that renders.
    if (payload?.organization) return payload.organization;

    // Otherwise the org is null — cleanly absent, or nulled by a non-null
    // nested field that failed. Those are indistinguishable from here, so the
    // CODE decides, exactly as it does in the layout. @copilot on #847: an
    // earlier version treated any payload-bearing rejection as this tab's 404,
    // which quietly turned a resolver CRASH (`INTERNAL_SERVER_ERROR`) into
    // "Organization not found" — the confident false statement #843 removed
    // from the layout, reintroduced one level down.
    const code = extractGqlErrorCode(e);
    if (code !== 'ORGANIZATION_NOT_FOUND' && code !== 'FORBIDDEN') throw e;
    data = { organization: null };
  }

  if (!data.organization) throw error(404, 'Organization not found');
  return data.organization;
}
