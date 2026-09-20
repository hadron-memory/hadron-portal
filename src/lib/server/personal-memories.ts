// #627/#629/#1176: the caller's own (org-less) memories — shared by the
// /app/memories list and the /app/dashboard stats.
//
// The server answers this directly now, via `ownedByMe`. These loaders used to
// ask for personal/private and then re-filter on `organizationId == null` in
// the client; the class half was a PROXY for ownership that stopped holding
// when a knowledge memory could be user-owned (#653), and the org-less half is
// what `ownedByMe` means by definition. Both are gone: ownership is not
// derivable from the fields the API exposes, so a client asks for the slice
// rather than computing it.
import { gqlClient } from './api';
import { fetchAllItems } from './paginate';
import {
  PERSONAL_MEMORIES_QUERY,
  PERSONAL_MEMORIES_LITE_QUERY,
  SHARED_MEMORIES_QUERY,
} from './queries';
import type { Memory } from '$lib/types';

/** Throws on query failure — callers decide how to surface it. */
export async function fetchOwnedMemories(token: string | null): Promise<Memory[]> {
  return fetchAllItems<Memory>(gqlClient(token), PERSONAL_MEMORIES_QUERY, 'memories');
}

/** A slim owner-only memory for pickers (#642). */
export interface OwnedMemoryLite {
  id: string;
  name: string;
  urn: string;
  class: string;
  organizationId: string | null;
  visibility: string | null;
}

/** Slim variant of {@link fetchOwnedMemories} — id/name/urn/class only, for the
 *  agent "Add memory" picker. USER-OWNED and org-less, per `ownedByMe`. */
export async function fetchOwnedMemoriesLite(token: string | null): Promise<OwnedMemoryLite[]> {
  return fetchAllItems<OwnedMemoryLite>(
    gqlClient(token),
    PERSONAL_MEMORIES_LITE_QUERY,
    'memories',
  );
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
