/**
 * Flow-routing edge semantics, mirrored from the server's walker
 * (hadron-server src/lib/runner/selectNextEdge.ts — spec 040
 * plan-multi-node §5). The portal never evaluates conditions; it only
 * needs to REPRODUCE the walker's candidate set and ordering so the
 * edge editor can show authors the effective firing order.
 *
 * Grammar (D-MN-4): ONLY edges named `next` or `next.<index>[.<label>]`
 * route. Everything else (`documents`, `depends-on`, …) is a
 * reference/annotation — invisible to the walker. An unnamed edge falls
 * back to the name segment of its derived loc
 * (`<sourceLoc>:<name>:<targetLoc>`).
 *
 * Ordering: `Edge.priority` ascending (lower fires first), then the
 * numeric `<index>` (numeric, so `next.2` before `next.10`; missing or
 * non-numeric index sorts last), then loc lexical. The first edge
 * without a condition always fires — the fall-through — so edges after
 * it in the order can never fire.
 */

export interface RoutingEdgeLike {
  name: string | null;
  loc: string;
  priority?: number | null;
  /** JSONLogic condition; null/undefined = always fires. */
  condition?: unknown;
}

/** `next` or `next.<anything>` routes; nothing else does. */
export function isRoutingName(name: string): boolean {
  return name === 'next' || name.startsWith('next.');
}

/** Routing name of an edge: explicit name, else the loc's derived segment. */
export function routingNameOf(edge: { name: string | null; loc: string }, sourceLoc: string): string {
  if (edge.name) return edge.name;
  const prefix = `${sourceLoc}:`;
  const rest = edge.loc.startsWith(prefix) ? edge.loc.slice(prefix.length) : edge.loc;
  return rest.split(':')[0] ?? '';
}

/** Numeric `<index>` from `next.<index>[...]`; missing/non-numeric sorts last. */
export function routingIndexOf(name: string): number {
  const second = name.split('.')[1];
  return second != null && /^\d+$/.test(second) ? Number(second) : Number.POSITIVE_INFINITY;
}

/**
 * Split a routing name into its authorable parts. `next` → both null;
 * `next.2` → index 2; `next.2.high-confidence` → index 2 + label.
 * A non-numeric second segment (`next.foo`) is treated as a label with
 * no index — it still routes, but sorts after every indexed edge.
 */
export function parseRoutingName(name: string): { index: number | null; label: string | null } {
  const parts = name.split('.');
  if (parts[0] !== 'next' || parts.length === 1) return { index: null, label: null };
  if (/^\d+$/.test(parts[1])) {
    return { index: Number(parts[1]), label: parts.length > 2 ? parts.slice(2).join('.') : null };
  }
  return { index: null, label: parts.slice(1).join('.') };
}

/**
 * Compose a routing name from order + optional human label, so authors
 * never type `next.<index>.<label>` by hand. The label is slugified
 * (dots are segment separators; colons are loc separators — both must
 * not survive into the name).
 */
export function buildRoutingName(index: number | null, label: string): string {
  const slug = slugifyLabel(label);
  if (index === null || !Number.isInteger(index) || index < 0) {
    return slug ? `next.${slug}` : 'next';
  }
  return slug ? `next.${index}.${slug}` : `next.${index}`;
}

/** Lowercase, spaces → dashes, strip everything but [a-z0-9-]. */
export function slugifyLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface RoutingOrderEntry<T extends RoutingEdgeLike> {
  edge: T;
  routingName: string;
  /** 1-based position in the walker's evaluation order. */
  position: number;
  /** No condition — always fires when reached (the fall-through). */
  isFallThrough: boolean;
  /** Sorted after a fall-through edge, so the walker never evaluates it. */
  isUnreachable: boolean;
}

/**
 * The walker's candidate list for one source node, in evaluation order,
 * with the fall-through and any unreachable edges marked.
 */
export function routingOrder<T extends RoutingEdgeLike>(
  edges: readonly T[],
  sourceLoc: string,
): Array<RoutingOrderEntry<T>> {
  const routable = edges
    .map((edge) => ({ edge, routingName: routingNameOf(edge, sourceLoc) }))
    .filter((e) => isRoutingName(e.routingName))
    .sort((a, b) => {
      const ap = a.edge.priority ?? 0;
      const bp = b.edge.priority ?? 0;
      if (ap !== bp) return ap - bp;
      const ai = routingIndexOf(a.routingName);
      const bi = routingIndexOf(b.routingName);
      if (ai !== bi) return ai - bi;
      return a.edge.loc.localeCompare(b.edge.loc);
    });

  let fallThroughSeen = false;
  return routable.map((e, i) => {
    const isFallThrough = e.edge.condition == null && !fallThroughSeen;
    const isUnreachable = fallThroughSeen;
    if (isFallThrough) fallThroughSeen = true;
    return { ...e, position: i + 1, isFallThrough, isUnreachable };
  });
}

/**
 * Next free `<index>` among a node's routing edges — the default order
 * for a newly-converted routing edge.
 */
export function nextFreeRoutingIndex(edges: readonly RoutingEdgeLike[], sourceLoc: string): number {
  let max = 0;
  for (const edge of edges) {
    const name = routingNameOf(edge, sourceLoc);
    if (!isRoutingName(name)) continue;
    const idx = routingIndexOf(name);
    if (Number.isFinite(idx) && idx > max) max = idx;
  }
  return max + 1;
}
