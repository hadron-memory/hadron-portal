import type { GraphQLClient } from 'graphql-request';
import type { NodeChoice, NodeChoicesPage, NodeRead } from '$lib/node-choices';

/**
 * portal#1576 — the node picker's server read. One lexical `findNodes` page
 * over ONE memory, with the viewer's own token (never a service token): the
 * server intersects `filter.memoryIds` with the caller's access, so a memory
 * the viewer cannot read comes back as the server's honest empty page —
 * passed through, never turned into a portal error.
 *
 * A lexical findNodes returns `total: null` (hadron-server#3113), so the
 * selection never asks for a total. Paging is the SERVER's word alone
 * (#1582 BLIND P2-3): `nextOffset` says where the next page starts and
 * `hasMore` whether one exists, both derived from the RAW row count — this
 * function's shape-guard can drop rows, and a dropped row must be invisible
 * to the window (a filtered page of 19 still consumed a 20-row window).
 * The client pages by `nextOffset` verbatim and never re-derives it.
 */
export const NODE_CHOICES_PAGE = 20;

/**
 * The offset ceiling, ONE source of truth (portal#1585, PM decision Patrick
 * 2026-11-01): the endpoint refuses any offset above it, and the read itself
 * answers `hasMore: false, capped: true` when the NEXT page would start past
 * it — so the picker never offers a Load more the endpoint must 400. There is
 * deliberately no client-side constant to keep in step. Inclusive: the
 * boundary value itself is a legal (if pointless) read.
 */
export const MAX_NODE_CHOICES_OFFSET = 100_000;

export const NODE_CHOICES_QUERY = /* GraphQL */ `
  query NodeChoices($memoryId: ID!, $query: String, $limit: Int, $offset: Int) {
    findNodes(filter: { memoryIds: [$memoryId] }, query: $query, mode: keyword, limit: $limit, offset: $offset) {
      hits {
        node { id name loc urn }
      }
    }
  }
`;

export async function nodeChoices(client: GraphQLClient, memoryId: string, offset: number, query?: string): Promise<NodeRead<NodeChoicesPage>> {
  try {
    const { findNodes } = await client.request<{ findNodes: { hits: Array<{ node: NodeChoice }> } }>(NODE_CHOICES_QUERY, {
      memoryId,
      query: query || null,
      limit: NODE_CHOICES_PAGE,
      offset,
    });
    // Both paging fields read the RAW page length, never the filtered items
    // (hrn:node:hadronmemory.com:hadron-portal:review:short-page-is-not-end-of-data):
    // a drop must not masquerade as end-of-data or shift the window. The urn
    // predicate is the SAME one the client applies — a row without a usable
    // urn is dropped HERE, so the two can never disagree over one page
    // (#1582 BLIND P2-3: they used to, turning a whole page into a failure).
    const raw = findNodes?.hits ?? [];
    const items = raw.map((hit) => hit.node).filter((node): node is NodeChoice => !!node && typeof node.id === 'string' && typeof node.urn === 'string' && node.urn !== '');
    // The ceiling is the READ's to enforce, not just the endpoint's (#1585):
    // a raw-full page whose next offset passes MAX_NODE_CHOICES_OFFSET must
    // not advertise that offset — the picker would render Load more for a
    // request the endpoint 400s, and Try again would resend it forever.
    // `capped` tells the picker to show the truncation note instead. A SHORT
    // page is end-of-data (hasMore:false, no cap): the data ended before the
    // ceiling did.
    const nextOffset = offset + raw.length;
    const full = raw.length === NODE_CHOICES_PAGE;
    const capped = full && nextOffset > MAX_NODE_CHOICES_OFFSET;
    return { kind: 'ok', value: { items, hasMore: full && !capped, nextOffset, ...(capped ? { capped: true } : {}) } };
  } catch {
    return { kind: 'failed' };
  }
}
