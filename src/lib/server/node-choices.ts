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
    return { kind: 'ok', value: { items, hasMore: raw.length === NODE_CHOICES_PAGE, nextOffset: offset + raw.length } };
  } catch {
    return { kind: 'failed' };
  }
}
