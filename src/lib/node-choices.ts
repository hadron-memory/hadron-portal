/**
 * portal#1576 — the node picker's row shape. `urn` is the SERVER-supplied
 * node URN (Node.urn, composed server-side per #481), returned by
 * `findNodes` and passed through verbatim; the client never builds a node
 * URN from a memory URN + loc (hrn:node:hadronmemory.com:hadron-portal:findings:spec-027-node-urn-parser-ambiguity).
 */
export type NodeChoice = {
  id: string;
  name: string;
  loc: string;
  urn: string;
};

/** The endpoint's read result: a failed read is distinguishable from an empty one. */
export type NodeRead<T> = { kind: 'ok'; value: T } | { kind: 'failed' };

/**
 * One page of choices. `nextOffset`/`hasMore` are the SERVER's raw-count word
 * on where the next page starts and whether one exists (#1582 BLIND P2-3):
 * the client pages by `nextOffset` verbatim and never re-derives it from the
 * (possibly filtered) rows it received. `capped` (#1585) is present (true)
 * only when the offset ceiling truncated the list: the next page would start
 * past the endpoint's bound, so `hasMore` is false AND the picker shows its
 * truncation note — the one case where "no more" does not mean "all shown".
 */
export type NodeChoicesPage = { items: NodeChoice[]; hasMore: boolean; nextOffset: number; capped?: boolean };
