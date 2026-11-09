import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlErrorCode } from '$lib/gql-error';
import { MEMORY_LAYOUT_ORG_QUERY, SELF_CAN_WRITE_QUERY, MEMORY_BY_ID_QUERY } from '$lib/server/queries';
import type { Organization, OrgMember, UserSummary, Memory } from '$lib/types';
import type { LayoutServerLoad } from './$types';

// What MEMORY_LAYOUT_ORG_QUERY selects, and no more: typing it as the full
// Organization would let a consumer read `memories` or `createdAt` and get
// undefined at runtime instead of a compile error (#1429).
export type MemoryLayoutOrg = Pick<Organization, 'id' | 'name' | 'urn'> & {
  members: Array<Pick<OrgMember, 'id' | 'role'> & { user: Pick<UserSummary, 'id'> }>;
};

// #260: memory pages are org-less (`/app/memories/[id]`) so a memory owned by
// an org the user is NOT a member of stays reachable. Data access is keyed on
// the memory id alone; the org is loaded only for breadcrumb + settings chrome.
export const load: LayoutServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);
  // portal#1524: no node-list drain (no memoryNodes/memoryEdges) on memory
  // entry; the memory itself is the only read the shell needs.
  const memoryData = await client.request<{ memory: Memory | null }>(MEMORY_BY_ID_QUERY, { ref: params.id });

  const memory = memoryData.memory;
  if (!memory) throw error(404, 'Memory not found');

  // #646: ask the same server gate writes use; a share role alone cannot
  // account for another grant. Failure keeps reading available, never editing.
  let canWriteMemory = false;
  if (locals.user?.id) {
    try {
      const access = await client.request<{ effectiveAccess: { canWrite: boolean } }>(SELF_CAN_WRITE_QUERY, {
        user: locals.user.id, resource: memory.urn,
      });
      canWriteMemory = access.effectiveAccess.canWrite === true;
    } catch {
      console.warn('[memory-layout] write access unavailable');
    }
  }

  // Load the owning org for breadcrumb + settings (members/urn). Keyed on the
  // memory's own organizationId, not a URL segment. MEMORY_LAYOUT_ORG_QUERY is
  // authz-gated. A null nested memory.organization already proves the viewer
  // is not a member, so no second guaranteed-refused request is needed. When a
  // member-shaped nested value is present, known access/domain refusals still
  // map to non-member; only transport/internal failures set orgReadFailed and
  // preserve chrome.
  // Guard the call: a memory with no owning org id (defensive — the schema
  // types it non-null) would otherwise fire a wasted request / non-null
  // GraphQL validation error.
  let orgReadFailed = false;
  const orgData = memory.organizationId && memory.organization !== null
    ? await client
        .request<{ organization: MemoryLayoutOrg | null }>(MEMORY_LAYOUT_ORG_QUERY, { ref: memory.organizationId })
        .catch((cause) => {
          const code = extractGqlErrorCode(cause);
          orgReadFailed = code !== 'FORBIDDEN' && code !== 'NOT_FOUND' && code !== 'ORGANIZATION_NOT_FOUND';
          return { organization: null };
        })
    : { organization: null };

  return {
    org: orgData.organization,
    orgReadFailed,
    graph: memory,
    canWriteMemory,
    // portal#1524 (Holger, 2026-10-31): the node list is deliberately NOT
    // loaded, which is a different state from "the load failed"
    // (`nodesFailed`, which shows an error banner) and from "this memory has no
    // nodes". Every consumer treats `nodesOff` as the degraded path it already
    // has for `nodesFailed`, without the banner, and none may read the absent
    // list as an empty memory. `nodesTotal` is null for the same reason: it is
    // not a count of anything.
    nodesOff: true as const,
    nodesFailed: false,
    nodesTotal: null,
  };
};
