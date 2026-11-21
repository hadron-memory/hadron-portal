import { gqlClient } from '$lib/server/api';
import { MEMORY_OWNER_PUBLIC_ORG_QUERY, MEMORY_SHARES_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import { memoryOwnerOrgUrn } from '$lib/urn/memory-owner-attribution';
import { parseUrn } from '$lib/urn/parse-urn';
import type { PageServerLoad } from './$types';

export type MemoryOwnerAttribution =
  | { id: string; name: string; urn: string; source: 'member' | 'public' }
  | { urn: string; source: 'memory-urn' };

/**
 * portal#1848: who the viewer is to a personal memory (hrn:node:hadronmemory.com:specs:cor:acl:010:02: it is
 * reachable through a MemoryShare, so "Only you" is true only when unshared).
 * `owner-*` is judged by the strict user principal; the server hides it from a
 * share recipient, so any other viewer is `other` (never called the owner).
 * `unknown` is a failed share read: no claim either way.
 */
export type PersonalAccess = 'owner-only' | 'owner-shared' | 'other' | 'unknown';

function isLegacyMemoryUrn(value: string | null | undefined): boolean {
  // The compatibility parser accepts flat v2 in either scheme, including
  // shapes the strict attribution helper rejects. A valid legacy-scheme v2 may
  // still use the known-id public lookup; malformed flat v2 must fail closed.
  if (typeof value !== 'string' || memoryOwnerOrgUrn(value)) return false;
  try {
    const parsed = parseUrn(value);
    if (parsed.type !== 'memory') return false;
    return !/^(?:hrn|urn):mem:/.test(value) || parsed.pathSegments.length === 2;
  } catch {
    return false;
  }
}

// Only the Info tab needs non-member attribution. Keeping this read out of the
// shared memory layout avoids a second organization round trip on every other
// tab, and keeps the sanitized projection separate from member-only `data.org`.
export const load: PageServerLoad = async ({ parent, locals }) => {
  const { graph, org, orgReadFailed } = await parent();
  let ownerAttribution: MemoryOwnerAttribution | null = null;

  if (graph.organizationId) {
    if (org) {
      const { id, name, urn } = org;
      ownerAttribution = { id, name, urn, source: 'member' };
    } else if (orgReadFailed && graph.organization) {
      // The nested memory read already disclosed this member identity. A later
      // hydration outage must not downgrade it to public/fallback attribution.
      const { id, name, urn } = graph.organization;
      ownerAttribution = { id, name, urn, source: 'member' };
    } else {
      const fallbackUrn = memoryOwnerOrgUrn(graph.urn);
      const legacyMemoryUrn = isLegacyMemoryUrn(graph.urn);
      if ((fallbackUrn || legacyMemoryUrn) && (graph.class !== 'system' || !graph.agent)) {
        const client = gqlClient(locals.token);
        let publicOrganization: Pick<Organization, 'id' | 'name' | 'urn'> | null = null;
        try {
          const result = await client.request<{
            publicOrganization: Pick<Organization, 'id' | 'name' | 'urn'> | null;
          }>(MEMORY_OWNER_PUBLIC_ORG_QUERY, { ref: graph.organizationId });
          publicOrganization = result.publicOrganization;
        } catch {
          // The checked contract intentionally makes denial and absence the same
          // attribution outcome: fall back to the already-disclosed memory root.
        }
        if (publicOrganization) {
          const { id, name, urn } = publicOrganization;
          ownerAttribution = { id, name, urn, source: 'public' };
        } else if (fallbackUrn) {
          ownerAttribution = { urn: fallbackUrn, source: 'memory-urn' };
        }
      }
    }
  }

  let personalAccess: PersonalAccess | null = null;
  if (graph.class === 'personal') {
    if (locals.user?.id && graph.userId === locals.user.id) {
      // `shares` is owner-only, so ask only the owner. Only a count is kept:
      // the roster itself never reaches the Info page.
      try {
        const result = await gqlClient(locals.token).request<{ memory: { shares: unknown[] | null } | null }>(
          MEMORY_SHARES_QUERY,
          { ref: graph.id },
        );
        personalAccess = result.memory?.shares ? (result.memory.shares.length > 0 ? 'owner-shared' : 'owner-only') : 'unknown';
      } catch {
        personalAccess = 'unknown';
      }
    } else {
      personalAccess = 'other';
    }
  }

  return { ownerAttribution, personalAccess };
};
