import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { ORG_CHROME_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { LayoutServerLoad } from './$types';

/**
 * What the layout puts on `data.org`: the chrome fields, and only those (#845).
 *
 * Typed as a SLICE of Organization rather than as Organization, so a consumer
 * that starts reading `org.memories` off the layout payload fails to COMPILE
 * instead of reading undefined at runtime. Tabs that need more fetch it
 * themselves and return their own (fuller) `org`, which takes precedence in the
 * page's merged `data`.
 */
export type OrgChrome = Pick<Organization, 'id' | 'name' | 'urn'>;

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
 *   URN_NOT_QUALIFIED       a relative-form or malformed URN in the route param.
 *   BAD_USER_INPUT          `resolveOrgRef` raises both BEFORE any DB lookup, so
 *                           they are facts about the ref, never about the
 *                           server's health.
 *   FORBIDDEN               a non-member read (typed on the wire by
 *                           hadron-server#1188; before that it was a plain
 *                           `Error` Apollo wrapped as INTERNAL_SERVER_ERROR,
 *                           indistinguishable from a resolver crash, which is
 *                           what #843 was about). 404 rather than 403 so the
 *                           refusal does not disclose that the org exists.
 *
 * `AmbiguousLegacyUrnError` is deliberately NOT here, though it is equally a
 * fact about the ref. It means the ref resolves to MORE than one org — the
 * opposite of absent — and hadron-server raises it precisely to fail loudly
 * rather than resolve to an arbitrary one. Answering "Organization not found"
 * would send the reader looking for a deleted org instead of a URN collision,
 * which is the same confident false statement this whole change removes. It
 * falls through to the 500, where a loud failure is what everyone involved
 * wants.
 */
const REF_NAMES_NO_OPENABLE_ORG: ReadonlySet<string> = new Set([
  'ORGANIZATION_NOT_FOUND',
  'URN_NOT_QUALIFIED',
  'BAD_USER_INPUT',
  'FORBIDDEN',
]);

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
    .request<{ organization: OrgChrome | null }>(ORG_CHROME_QUERY, { ref: params.id })
    .catch((e: unknown) => {
      // #843: this branch used to coerce EVERY rejection to 404, so a server
      // outage told the user their organization does not exist.
      //
      // Since #845 the only tabs still reading this payload are the ones that
      // need NOTHING but the chrome — apps, runs, sessions, ai-configs. The
      // tabs that render a list (profile, memories, agents, integrations,
      // tasks) fetch their own slice, so this branch is no longer the error
      // behaviour of the whole org surface. It is still the error behaviour of
      // the chrome, which every tab draws, so it stays the strictest one here.
      //
      // #845 is why the query above is `ORG_CHROME_QUERY` and not
      // `ORGANIZATION_QUERY`. Every nested field on Organization is non-null in
      // the SDL while `organization(ref:)` is nullable, so null propagation
      // carried ANY nested resolver failure up to `organization` — and this
      // catch, unable to tell that from a missing org, answered for the whole
      // surface. A scalar-only selection has no nested resolver to fail, so the
      // verdict below is now about the ORG and nothing else. (Salvaging a
      // partial `data.organization` was tried on #844 and is unreachable by
      // construction for the same propagation reason — see
      // `hrn:node:hadronmemory.com:hadron-portal:findings:null-propagation-makes-partial-salvage-unreachable`
      // before reaching for it again.)
      const code = extractGqlErrorCode(e);

      // No GraphQL errors payload at all: the server never answered with one.
      // graphql-request reports a connection failure, a bad gateway or an HTML
      // error body this way, and none of them can be a refusal — a refusal is
      // something a working server decided. This is the issue's headline case
      // and the one arm that needs no code to be sure of.
      if (code === null) throw e;

      if (REF_NAMES_NO_OPENABLE_ORG.has(code)) {
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
