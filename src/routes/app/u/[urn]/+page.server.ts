import { error, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { RESOLVE_URN_QUERY } from '$lib/server/queries';
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
 */
type UrnResolution = {
  kind: 'memory' | 'node' | 'agent' | 'org' | 'app';
  id: string;
  memoryId: string | null;
  organizationId: string | null;
};

const KNOWN_KINDS = new Set<UrnResolution['kind']>(['memory', 'node', 'agent', 'org', 'app']);

export const load: PageServerLoad = async ({ params, locals }) => {
  const urn = normalizeUrn(params.urn);

  const { resolveUrn } = await gqlClient(locals.token).request<{
    resolveUrn: UrnResolution | null;
  }>(RESOLVE_URN_QUERY, { urn });

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

  // 307 (temporary, method-preserving) — NOT 308. URN aliases deliberately
  // survive PK changes (#262), so the canonical target can change over time;
  // a permanent redirect would be cached by browsers/proxies and bypass this
  // resolver forever, stranding clients on a stale PK. 307 also keeps the
  // access check fresh on every visit. The extra round-trip is the accepted
  // cost of stable aliases.
  redirect(307, target);
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
    case 'app':
      // Apps live under their org; organizationId is always set by the resolver.
      return r.organizationId ? `/app/orgs/${r.organizationId}/apps/${r.id}` : null;
    default:
      return null;
  }
}
