// #627/#629: the caller's own (org-less) memories — shared by the /app/memories
// list and the /app/dashboard stats. The server returns the caller's accessible
// personal/private memories; keep only the ones with no owning org, which are
// the ones this user owns directly (chk_memory_owner_xor → organizationId NULL).
import { gqlClient } from './api';
import { fetchAllItems } from './paginate';
import { PERSONAL_MEMORIES_QUERY, SHARED_MEMORIES_QUERY } from './queries';
import type { Memory } from '$lib/types';

/** Throws on query failure — callers decide how to surface it. */
export async function fetchOwnedMemories(token: string | null): Promise<Memory[]> {
  const memories = await fetchAllItems<Memory>(gqlClient(token), PERSONAL_MEMORIES_QUERY, 'memories');
  return memories.filter((m) => m.organizationId == null);
}

/** One memory another user has shared with the caller (#778). `myShare` is the
 *  caller's OWN grantee row — who shared it (`grantor`) and the caller's role. */
export interface SharedMemory {
  id: string;
  name: string;
  urn: string;
  class: string;
  myShare: {
    role: 'reader' | 'writer';
    grantor: { id: string; handle: string | null; name: string | null };
  } | null;
}

/** Memories shared WITH the caller (grantee). Throws on query failure. */
export async function fetchSharedMemories(token: string | null): Promise<SharedMemory[]> {
  return fetchAllItems<SharedMemory>(gqlClient(token), SHARED_MEMORIES_QUERY, 'memories');
}
