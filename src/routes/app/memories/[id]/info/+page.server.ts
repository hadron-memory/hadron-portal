import { gqlClient } from '$lib/server/api';
import { MEMORY_OWNER_PUBLIC_ORG_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import { memoryOwnerOrgUrn } from '$lib/urn/memory-owner-attribution';
import { parseUrn } from '$lib/urn/parse-urn';
import type { PageServerLoad } from './$types';

export type MemoryOwnerAttribution =
  | { id: string; name: string; urn: string; source: 'member' | 'public' }
  | { urn: string; source: 'memory-urn' };

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

  return { ownerAttribution };
};
