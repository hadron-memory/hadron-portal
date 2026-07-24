// #627/#629: the caller's own (org-less) memories — shared by the /app/memories
// list and the /app/dashboard stats. The server returns the caller's accessible
// personal/private memories; keep only the ones with no owning org, which are
// the ones this user owns directly (chk_memory_owner_xor → organizationId NULL).
import { gqlClient } from './api';
import { fetchAllItems } from './paginate';
import { PERSONAL_MEMORIES_QUERY } from './queries';
import type { Memory } from '$lib/types';

/** Throws on query failure — callers decide how to surface it. */
export async function fetchOwnedMemories(token: string | null): Promise<Memory[]> {
  const memories = await fetchAllItems<Memory>(gqlClient(token), PERSONAL_MEMORIES_QUERY, 'memories');
  return memories.filter((m) => m.organizationId == null);
}
