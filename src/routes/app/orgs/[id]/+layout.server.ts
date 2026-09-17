import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { ORGANIZATION_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { LayoutServerLoad } from './$types';

/**
 * #843 — the codes that mean "this URL names no org you can open", so a 404 is
 * the honest answer. Everything NOT listed propagates and becomes a 500.
 *
 * Every entry is lifted from the server's `formatError.ts` mapping table rather
 * than guessed. A guessed SCREAMING_CASE constant matches nothing and fails
 * silently — `hrn:node:hadronmemory.com:hadron-portal:findings:node-write-error-codes-are-class-names`
 * is that mistake, and `AmbiguousLegacyUrnError` below is why it matters here:
 * that code really is the class name, not `AMBIGUOUS_LEGACY_URN`.
 *
 *   ORGANIZATION_NOT_FOUND  the ref resolved to nothing (typed on the wire by
 *                           hadron-server#1175; before that it existed only
 *                           inside the message text).
 *   URN_NOT_QUALIFIED       a relative-form URN in the route param. `resolveOrgRef`
 *   BAD_USER_INPUT          raises both BEFORE any DB lookup, so they are facts
 *   AmbiguousLegacyUrnError about the ref, never about the server's health. An
 *                           org renamed twice can make the third one reachable.
 *   FORBIDDEN               a non-member read. 404 rather than 403 so the
 *                           refusal does not disclose that the org exists.
 *
 * FORBIDDEN cannot fire from this query yet — see UNTYPED_REFUSAL below. It is
 * listed anyway, deliberately: it is not speculative copy for an invented state
 * (the trap `hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only`
 * warns about) but the post-fix half of a mapping whose pre-fix half is the arm
 * directly underneath, and having both here is what makes that arm a clean
 * delete instead of an edit.
 */
const REF_NAMES_NO_OPENABLE_ORG: ReadonlySet<string> = new Set([
  'ORGANIZATION_NOT_FOUND',
  'URN_NOT_QUALIFIED',
  'BAD_USER_INPUT',
  'AmbiguousLegacyUrnError',
  'FORBIDDEN',
]);

/**
 * TEMPORARY, and a deliberate deviation from
 * `hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only`,
 * which names INTERNAL_SERVER_ERROR as the one code no allowlist may map.
 *
 * `organization(ref:)` refuses a non-member with `throw new Error('Forbidden')`
 * (hadron-server `resolvers.query.org.ts:446`) — a plain Error, which Apollo
 * wraps as INTERNAL_SERVER_ERROR, keeping the message and dropping the type.
 * So a permission boundary and a genuine resolver crash arrive under one code,
 * and the portal cannot tell them apart.
 *
 * Both ways out of that are worse than this arm:
 *
 *   - matching the message text `Forbidden` keys behaviour on prose that is not
 *     a contract — `hrn:node:hadronmemory.com:dev:conventions:the-error-code-is-the-contract-the-prose-is-not`,
 *     which names this exact move and says the wrong code is better fixed than
 *     compensated for;
 *   - letting it through as a 500 regresses the non-member from a correct 404
 *     to an outage page, AND opens an enumeration channel this route does not
 *     have today (404 for absent, 500 for present-but-private).
 *
 * So the pre-existing 404 is KEPT for this code, with its lie narrowed from
 * "every rejection" to "a resolver crash", and the honest fix requested where
 * it belongs. DELETE this constant and its branch once the server types that
 * refusal: `FORBIDDEN` is already in the set above, so nothing else changes.
 */
const UNTYPED_REFUSAL = 'INTERNAL_SERVER_ERROR';

// #336: org-detail is a tab layout (mirrors /app/memories/[id]). The layout
// renders the breadcrumb + header + tab bar; each tab is a sub-route rendered
// via {@render children()}. The org is loaded here so the header/tabs have it
// on every tab without each page re-fetching it for chrome.
//
// NOTE: `requireNonConsumer` is intentionally NOT applied here. The Profile
// tab (the index page) IS the dashboard, and guards.ts redirects consumer-mode
// users to `/app/orgs/<activeOrgId>/` — applying the guard would loop. The
// admin-only sub-routes keep their own guard.
export const load: LayoutServerLoad = async ({ params, locals }) => {
  const data = await gqlClient(locals.token)
    .request<{ organization: Organization | null }>(ORGANIZATION_QUERY, { ref: params.id })
    .catch((e: unknown) => {
      // #843: this branch used to coerce EVERY rejection to 404, so a server
      // outage told the user their organization does not exist. Since #842 the
      // memories, agents and apps loaders read this layout's org via parent()
      // instead of fetching their own, which makes this one branch the error
      // behaviour of the whole org surface.
      const code = extractGqlErrorCode(e);

      // No GraphQL errors payload at all: the server never answered with one.
      // graphql-request reports a connection failure, a bad gateway or an HTML
      // error body this way, and none of them can be a refusal — a refusal is
      // something a working server decided. This is the issue's headline case
      // and the one arm that needs no code to be sure of.
      if (code === null) throw e;

      if (REF_NAMES_NO_OPENABLE_ORG.has(code) || code === UNTYPED_REFUSAL) {
        throw error(404, 'Organization not found');
      }

      // Anything else is a code this route has no answer for. Rethrowing keeps
      // it a distinguishable 500 rather than a confident false statement about
      // the org — the whole point of the issue.
      throw e;
    });

  if (!data.organization) throw error(404, 'Organization not found');
  return { org: data.organization };
};
