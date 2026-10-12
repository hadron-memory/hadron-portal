import { gqlClient } from '$lib/server/api';
import { loadOrgDetail } from '$lib/server/org-detail';
import { fetchAllItems } from '$lib/server/paginate';
import { ORG_SYSTEM_MEMORY_IDS_QUERY } from '$lib/server/queries';

/**
 * #1689 — the memory ids the Task Nodes tab (and its skill export) scope to:
 * the org's ordinary memories (`document` selects `organization { id memories
 * { id } }`) PLUS its system-class memories, which `Organization.memories`
 * omits. These ids are the security boundary for the server's `memoryIds`
 * filters, so callers must still refuse an EMPTY result rather than query
 * with it.
 *
 * The system list is best-effort: if it fails the ordinary memories still
 * list, and `systemFailed` lets the page say the listing may be incomplete
 * instead of silently dropping role-agent tasks again.
 */
export async function orgTaskMemoryIds(
  token: string | null | undefined,
  orgRef: string,
  document: string,
): Promise<{ ids: string[]; org: { id: string; name?: string | null } | null; systemFailed: boolean }> {
  const org = await loadOrgDetail<{ id: string; name?: string | null; memories?: Array<{ id: string }> | null } | null>(
    token,
    orgRef,
    document,
  );
  const ids = (org?.memories ?? []).map((m) => m.id);
  if (!org?.id) return { ids, org: null, systemFailed: false };

  let systemFailed = false;
  try {
    const system = await fetchAllItems<{ id: string }>(gqlClient(token), ORG_SYSTEM_MEMORY_IDS_QUERY, 'memories', {
      orgId: org.id,
    });
    for (const m of system) if (!ids.includes(m.id)) ids.push(m.id);
  } catch (err) {
    console.error('[org tasks] system memory ids failed:', err);
    systemFailed = true;
  }
  return { ids, org, systemFailed };
}
