import { error, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { RESOLVE_URN_QUERY } from '$lib/server/queries';
import { normalizeUrn } from '$lib/urn/parse-urn';
import type { PageServerLoad } from './$types';

/**
 * #262 — URN resolver route. Takes a Hadron URN in a single path segment
 * (URNs are colon-delimited, never slash-delimited, so the whole URN fits
 * one SvelteKit segment) and 308-redirects to the resource's canonical
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
    // A kind we resolved but have no canonical portal page for yet. Treat as
    // not-found rather than redirecting to a broken path.
    throw error(404, `No canonical page for ${resolveUrn.kind} URNs yet.`);
  }

  // 308 (permanent, method-preserving) — URN aliases are stable, so the
  // redirect is cacheable.
  redirect(308, target);
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
