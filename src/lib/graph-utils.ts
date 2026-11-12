import type { MemoryNode, TreeEntry, Topic, FolderNode, HierEdge, GraphViewData } from './types';
import { composeNodeUrn } from './urn/compose-node-urn';

/**
 * Build a flat list of TreeEntry objects from MemoryNode[].
 * Synthesizes virtual folder nodes for intermediate paths that have no real node.
 * Uses node.id as the entry ID to avoid collisions across memories.
 */
export function buildTreeEntries(nodes: MemoryNode[], memoryUrn?: string): TreeEntry[] {
  // Strip memory URN prefix from locs if present (some nodes may have the
  // memory URN baked into their loc, e.g. "micromentor.org:mmdata:tasks"
  // instead of just "tasks")
  function normalizeLoc(loc: string): string {
    if (memoryUrn && loc.startsWith(memoryUrn + ':')) {
      return loc.slice(memoryUrn.length + 1);
    }
    return loc;
  }

  const normalized = nodes.map((n) => ({ ...n, loc: normalizeLoc(n.loc) }));
  const locSet = new Set(normalized.map((n) => n.loc));
  const entries: TreeEntry[] = [];
  const seenVirtual = new Set<string>();

  // Sort by loc for consistent ordering
  const sorted = [...normalized].sort((a, b) => a.loc.localeCompare(b.loc));

  for (const n of sorted) {
    // Synthesize virtual parents that don't have a real node
    const parts = n.loc.split(':');
    for (let i = 1; i < parts.length; i++) {
      const ancestorLoc = parts.slice(0, i).join(':');
      if (!locSet.has(ancestorLoc) && !seenVirtual.has(ancestorLoc)) {
        seenVirtual.add(ancestorLoc);
        entries.push({
          id: ancestorLoc,
          nodeId: null,
          name: parts[i - 1],
          seq: null,
          nodeType: 'info',
          hasActions: false,
          isVirtual: true,
        });
      }
    }

    entries.push({
      id: n.loc,
      nodeId: n.id,
      name: n.name,
      seq: n.seq,
      nodeType: n.nodeType ?? 'info',
      hasActions: n.isRunnable ?? false,
      isVirtual: false,
    });
  }

  // Deduplicate entries by id (keep first occurrence)
  const seen = new Set<string>();
  const deduped = entries.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  return deduped.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Build GraphViewData from a flat list of MemoryNode[] for the TopicGraph component.
 * Uses node.id (DB primary key) as the graph node ID to avoid collisions across memories.
 */
export function buildGraphViewData(nodes: MemoryNode[], memoryUrn?: string): GraphViewData {
  // Strip memory URN prefix from locs if present
  if (memoryUrn) {
    const prefix = memoryUrn + ':';
    nodes = nodes.map((n) =>
      n.loc.startsWith(prefix) ? { ...n, loc: n.loc.slice(prefix.length) } : n,
    );
  }
  const idSet = new Set(nodes.map((n) => n.id));
  const locToId = new Map<string, string>(); // loc → first node.id at that loc
  const topics: Topic[] = [];
  const folderNodeMap = new Map<string, FolderNode>();
  const hierEdges: HierEdge[] = [];

  // Build loc→id mapping (first node at each loc wins for folder edge targets)
  for (const n of nodes) {
    if (!locToId.has(n.loc)) locToId.set(n.loc, n.id);
  }

  for (const n of nodes) {
    const parts = n.loc.split(':');
    const domain = parts[0];
    const depth = parts.length - 1;

    // Build topic — outgoing edges reference target node IDs. #656: an edge
    // whose target is null (a memory the caller can't read) has no node in this
    // graph to point at, so it's dropped — the idSet check already excluded any
    // target outside the rendered set.
    const outgoing = n.outgoingEdges
      .filter((e) => e.target != null && idSet.has(e.target.id))
      .map((e) => ({
        id: e.id,
        rel: e.name ?? e.loc, // edge name (spec 037, was label); fall back to loc when unnamed
        loc: e.target!.id, // use target's node.id as the graph reference
        name: e.target!.name,
      }));

    // Prefer the authorized node URN even when its Memory record is withheld.
    // Older reads use the function-scoped memoryUrn parameter; fall back to the
    // node's own memory.urn (some queries don't populate it). If neither
    // is available, render bare loc — composeNodeUrn would throw, and a
    // graph view shouldn't crash because a query shape changed.
    // R-2 (2026-05-06): also guard empty n.loc — the prefix-slice on
    // lines 75-80 can yield an empty loc when a node's loc equals the
    // memory-URN prefix exactly (with trailing colon).
    const ownerUrn = memoryUrn || n.memory?.urn || '';
    topics.push({
      id: n.id, // use DB primary key as graph node ID
      loc: n.loc,
      urn: n.urn || (ownerUrn && n.loc ? composeNodeUrn(ownerUrn, n.loc) : n.loc),
      name: n.name,
      depth,
      description: n.description ?? '',
      tags: n.tags,
      domain,
      nodes: outgoing,
    });

    // Build hierarchy edges (parent folder → child node)
    if (parts.length > 1) {
      const parentLoc = parts.slice(0, -1).join(':');
      // Parent is either a real node (use its ID) or a folder node (use loc as ID)
      const parentId = locToId.get(parentLoc) ?? parentLoc;
      hierEdges.push({ from: parentId, to: n.id });

      // Ensure intermediate folder nodes exist
      for (let i = 1; i < parts.length; i++) {
        const folderLoc = parts.slice(0, i).join(':');
        if (!locToId.has(folderLoc) && !folderNodeMap.has(folderLoc)) {
          folderNodeMap.set(folderLoc, {
            id: folderLoc, // virtual folder uses loc as ID (no DB id)
            name: parts[i - 1],
            domain: parts[0],
            isDomain: i === 1,
          });
          // Add hier edge from grandparent to this folder
          if (i > 1) {
            const grandparentLoc = parts.slice(0, i - 1).join(':');
            const grandparentId = locToId.get(grandparentLoc) ?? grandparentLoc;
            hierEdges.push({ from: grandparentId, to: folderLoc });
          }
        }
      }
    }

    // Domain root folder node
    if (!folderNodeMap.has(domain) && !locToId.has(domain)) {
      folderNodeMap.set(domain, {
        id: domain,
        name: domain,
        domain,
        isDomain: true,
      });
    }
  }

  return {
    topics,
    folderNodes: [...folderNodeMap.values()],
    hierEdges,
  };
}

/**
 * The tree without its hidden-type nodes. A VIRTUAL entry (a synthesized
 * folder) has no type of its own, so it stays exactly when something visible
 * still sits under it: dropping it then would orphan its children, and keeping
 * it otherwise shows an empty folder. portal#1014 is why the second half
 * matters: every comment lives at `comments:<id>`, so a memory with discussions
 * would otherwise show an empty `comments` folder.
 */
export function withoutHiddenTreeEntries(entries: TreeEntry[], isHidden: (nodeType: string | null | undefined) => boolean): TreeEntry[] {
  const visibleReal = entries.filter((e) => !e.isVirtual && !isHidden(e.nodeType));
  const keepVirtual = new Set<string>();
  for (const e of visibleReal) {
    const parts = e.id.split(':');
    for (let i = 1; i < parts.length; i++) keepVirtual.add(parts.slice(0, i).join(':'));
  }
  return entries.filter((e) => (e.isVirtual ? keepVirtual.has(e.id) : !isHidden(e.nodeType)));
}

/**
 * #531: pick the visible tree entries for the active search. When the server-
 * backed content search publishes the set of matched node PKs
 * (`searchResultNodeIds` — name + tags + description + body), scope the tree to
 * those, plus every loc-ancestor so a deep match stays reachable (ancestors are
 * virtual folder entries keyed by loc). Otherwise fall back to the local
 * name/id substring match (TreeView's own box, hideSearch=false consumers).
 *
 * Matches on TreeEntry.nodeId (the PK) rather than the loc — a raw server loc
 * wouldn't match the URN-prefix-normalized TreeEntry.id, and PKs are unique +
 * normalization-proof. Virtual folder entries (nodeId === null) never match
 * directly; they enter via the ancestor pass.
 *
 * `pool` is the already hidden-type-filtered entry list. Pure so it can be unit-
 * tested independently of the component's reactivity.
 */
export function scopeTreeEntriesToSearch(
  pool: TreeEntry[],
  searchResultNodeIds: Set<string> | null,
  search: string,
): TreeEntry[] {
  const withAncestors = (matching: TreeEntry[]): Set<string> => {
    const ids = new Set(matching.map((e) => e.id));
    for (const entry of matching) {
      const parts = entry.id.split(':');
      for (let i = 1; i < parts.length; i++) ids.add(parts.slice(0, i).join(':'));
    }
    return ids;
  };

  if (searchResultNodeIds) {
    const ids = withAncestors(pool.filter((e) => e.nodeId != null && searchResultNodeIds.has(e.nodeId)));
    return pool.filter((e) => ids.has(e.id));
  }

  if (!search.trim()) return pool;
  const q = search.toLowerCase();
  const ids = withAncestors(
    pool.filter((e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)),
  );
  return pool.filter((e) => ids.has(e.id));
}

/**
 * #1017 — where the graph popup's "Open" goes. A single-memory page passes its
 * `/app/memories/<id>` basePath, so the node's own page is one hop away. A
 * multi-memory graph (an App's or an Agent's) passes none, and used to show no
 * Open at all; the node's URN still resolves through `/app/u/<urn>`, which is
 * what every other cross-memory link in the portal uses.
 */
export function graphNodeHref(basePath: string | undefined, topic: { id: string; urn: string }): string {
  return basePath ? `${basePath}/nodes/${topic.id}` : `/app/u/${topic.urn}`;
}
