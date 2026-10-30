import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  MEMORY_LAYOUT_ORG_QUERY,
  SELF_CAN_WRITE_QUERY,
  MEMORY_BY_ID_QUERY,
} from '$lib/server/queries';
import type { Organization, Memory } from '$lib/types';
import type { LayoutServerLoad } from './$types';

// portal#1433: this layout loads NO graph. The whole node graph is drained by the
// `(browser)` route group's layout, so only the Nodes and Graph tabs pay for it.
//
// #260: memory pages are org-less (`/app/memories/[id]`) so a memory owned by
// an org the user is NOT a member of stays reachable. Data access is keyed on
// the memory id alone; the org is loaded only for breadcrumb + settings chrome.
export const load: LayoutServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);
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
  // authz-gated, so a non-member viewer gets `org: null` — the settings page
  // guards on that and hides member-only affordances (server enforces anyway).
  // Guard the call: a memory with no owning org id (defensive — the schema
  // types it non-null) would otherwise fire a wasted request / non-null
  // GraphQL validation error.
  const orgData = memory.organizationId
    ? await client
        .request<{ organization: Organization | null }>(MEMORY_LAYOUT_ORG_QUERY, { ref: memory.organizationId })
        .catch(() => ({ organization: null }))
    : { organization: null };

  return {
    org: orgData.organization,
    graph: memory,
    canWriteMemory,
  };
};
