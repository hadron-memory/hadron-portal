import { error, redirect } from '@sveltejs/kit';
import { ClientError } from 'graphql-request';
import { gqlClient } from '$lib/server/api';
import { RESOLVE_URN_QUERY } from '$lib/server/queries';
import { withQuery } from '$lib/safeRedirect';
import { normalizeUrn } from '$lib/urn/parse-urn';
import type { PageServerLoad } from './$types';

/**
 * #262 — URN resolver route. Takes a Hadron URN in a single path segment
 * (URNs are colon-delimited, never slash-delimited, so the whole URN fits
 * one SvelteKit segment) and 307-redirects to the resource's canonical
 * PK-based page. URN links are stable, shareable aliases that survive PK
 * changes; the canonical page stays the single real page per resource.
 *
 * Resolution + access control live entirely in the server's `resolveUrn`
 * query, which returns null both for unresolvable URNs and for resources
 * the caller can't reach — so a no-access URN 404s exactly like a
 * nonexistent one, never disclosing existence. The route is namespaced
 * under `/app/u/` so a bare `[urn]` can't shadow the static `/app/*`
 * children (dashboard, agents, …).
 *
 * #761 — the redirect carries the incoming QUERY STRING through to the
 * canonical page. A URN link is the form we ask people to share, so every
 * deep link the portal has deliberately made linkable (`?tab=`, `?chat=`,
 * the #739 worklog filters) travels through here; dropping the query landed
 * the reader on the target's default view, having resolved and rendered
 * without erroring. That is the expensive kind of wrong — it looks like it
 * worked. The fragment needs no handling: browsers never send it, and
 * re-apply the original to a redirect target that carries none.
 */
type UrnResolution = {
  kind: 'memory' | 'node' | 'agent' | 'org' | 'app' | 'user' | 'worker';
  id: string;
  memoryId: string | null;
  organizationId: string | null;
};

const KNOWN_KINDS = new Set<UrnResolution['kind']>([
  'memory',
  'node',
  'agent',
  'org',
  'app',
  'user',
  // #735: the server has resolved `hrn:worker:` since #991, but the portal had
  // no page for it — so every worker identity signature required by
  // hadron-server#1008 landed the reader on this route's 404. That is the
  // opposite of what a signature is for, and it made the platform look like it
  // was pointing at something that did not exist.
  'worker',
]);

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const urn = normalizeUrn(params.urn);

  // #567: a URN the server *rejects* (GraphQL error) must not surface as an
  // unhandled 500 — but only KNOWN rejection codes are mapped, and only when
  // the ClientError actually carries a GraphQL errors payload (graphql-request
  // also uses ClientError for transport-level failures, which have none).
  // Validation codes → 400; expired/missing auth → the same signin redirect
  // the app hooks issue; not-found/no-access codes → the existence-hiding 404.
  // Everything else — internal server errors, unknown codes, payload-less
  // transport failures, non-GraphQL exceptions — rethrows so a genuine outage
  // stays a distinguishable 500 (see review:no-silent-loader-catch).
  let resolveUrn: UrnResolution | null;
  try {
    ({ resolveUrn } = await gqlClient(locals.token).request<{
      resolveUrn: UrnResolution | null;
    }>(RESOLVE_URN_QUERY, { urn }));
  } catch (err) {
    if (err instanceof ClientError && err.response?.errors?.length) {
      const code = (err.response.errors[0].extensions as { code?: string } | undefined)?.code;
      if (code === 'BAD_USER_INPUT' || code === 'GRAPHQL_VALIDATION_FAILED') {
        throw error(400, `"${urn}" is not a valid Hadron URN.`);
      }
      if (code === 'UNAUTHENTICATED' || code === 'SESSION_EXPIRED') {
        // #761: `url.search` too — signing in to reach a deep link must not be
        // what costs you the deep link's state.
        redirect(
          303,
          `/signin?redirect=${encodeURIComponent(withQuery(`/app/u/${params.urn}`, url.search))}`,
        );
      }
      if (
        code === 'NOT_FOUND' ||
        code === 'NODE_NOT_FOUND' ||
        code === 'FORBIDDEN' ||
        code === 'PERMISSION_DENIED'
      ) {
        throw error(404, 'No resource found for this URN, or you do not have access to it.');
      }
    }
    throw err;
  }

  if (!resolveUrn) {
    throw error(404, 'No resource found for this URN, or you do not have access to it.');
  }

  const target = canonicalPath(resolveUrn);
  if (!target) {
    if (!KNOWN_KINDS.has(resolveUrn.kind)) {
      // A kind the server resolved but the portal has no canonical page for.
      throw error(404, `No canonical portal page for "${resolveUrn.kind}" URNs.`);
    }
    // Known kind, but a required parent id was missing (node without memoryId,
    // app without organizationId) — a malformed/incomplete resolution rather
    // than a normal not-found. Surface that explicitly instead of redirecting
    // to a broken path.
    throw error(
      500,
      `Incomplete resolution for "${urn}": the ${resolveUrn.kind} is missing the ids needed to build its page.`,
    );
  }

  // 307 (temporary, method-preserving) — NOT 308, and this is a durable
  // platform contract rather than a local preference:
  // `hrn:node:hadronmemory.com:specs:cor:api:230:01` makes the temporary
  // redirect load-bearing in BOTH directions. A permanent
  // redirect would be cached by browsers/proxies and bypass this resolver
  // forever, stranding clients on a stale PK (URN aliases deliberately survive
  // PK changes, #262) — AND it would remove the per-visit access re-check,
  // which is what keeps a link a *pointer* rather than a capability: holding
  // one grants nothing, because resolution runs the resource's ordinary read
  // gate every time. That second reason is why a link may safely be handed to
  // someone who cannot open it, and it is the half this comment used to state
  // only in passing. The extra round-trip is the accepted cost.
  redirect(307, withQuery(target, url.search));
};

/** Map a resolved URN to its canonical PK-based portal path. */
function canonicalPath(r: UrnResolution): string | null {
  switch (r.kind) {
    case 'memory':
      return `/app/memories/${r.id}`;
    case 'node':
      // memoryId is always set for nodes by the server resolver.
      return r.memoryId ? `/app/memories/${r.memoryId}/nodes/${r.id}` : null;
    case 'org':
      return `/app/orgs/${r.id}`;
    case 'agent':
      return `/app/agents/${r.id}`;
    case 'user':
      // #533: public profile page, PK-scoped like the other canonical pages.
      return `/app/user/${r.id}`;
    case 'app':
      // #648: canonical org-optional detail resolves both org-owned and
      // user-owned (org-less) apps, so a copied /app/u/<app-urn> link works for
      // a personal app too.
      return `/app/apps/${r.id}`;
    case 'worker':
      // #735/#991. Deliberately its OWN page rather than a redirect to the
      // App's Staff tab: the reader arriving from a signed GitHub issue is
      // asking "who is this", and a staff roster answers "which team" — so a
      // redirect would be both churn and the wrong answer (#737).
      //
      // Needs no id beyond `r.id`: `UrnResolution` carries no `appId`, but the
      // worker page reads `Worker.app` directly, so there is nothing to be
      // missing here.
      return `/app/workers/${r.id}`;
    default:
      return null;
  }
}
