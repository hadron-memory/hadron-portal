/**
 * portal#2245 — the role tasks a finished task's assignee followed
 * (`result.workedFromRoleTaskRefs`, hadron-server#4414,
 * hrn:node:hadronmemory.com:specs:cor:agt:050:30). Stored once at finish and
 * never changed; the portal only reads it.
 */
export interface RoleTaskRef {
  nodeId: string;
  urn: string;
  /** The node's revision when the task finished — not its current one. */
  revision: number;
}

/**
 * The name a row shows. The result stores no name, so it is read live; when that
 * read gave none (the viewer can no longer read the node, it was deleted, or the
 * read failed) the row falls back to the URN's last segment. The fallback is the
 * same for every cause, so it says nothing about why the name is missing.
 */
export function roleTaskLabel(ref: RoleTaskRef, names: Record<string, string> | undefined): string {
  const name = names?.[ref.nodeId];
  if (name && name.trim()) return name;
  const leaf = ref.urn.slice(ref.urn.lastIndexOf(':') + 1);
  return leaf || ref.urn;
}
