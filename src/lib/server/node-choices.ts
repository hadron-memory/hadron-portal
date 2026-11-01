import type { GraphQLClient } from 'graphql-request';
import type { NodeChoice, NodeRead } from '$lib/node-choices';

/**
 * portal#1576 — the node picker's server read. One lexical `findNodes` page
 * over ONE memory, with the viewer's own token (never a service token): the
 * server intersects `filter.memoryIds` with the caller's access, so a memory
 * the viewer cannot read comes back as the server's honest empty page —
 * passed through, never turned into a portal error.
 *
 * A lexical findNodes returns `total: null` (hadron-server#3113), so the
 * selection never asks for a total and paging stops on a short page
 * (items < limit ⇒ exhausted), like the task picker's pages. That inference
 * is a property of the RESOLVER, read and confirmed
 * (resolvers.query.node.ts): keyword mode pages with LIMIT/OFFSET in the
 * lexical SQL itself, and the only step between that take and this caller is
 * the hydration re-fetch re-asserting scope + structured filters — rows drop
 * only in a concurrent-mutation race, which #1576's explicit short-page
 * ruling accepts.
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

export async function nodeChoices(client: GraphQLClient, memoryId: string, offset: number, query?: string): Promise<NodeRead<{ items: NodeChoice[]; hasMore: boolean }>> {
  try {
    const { findNodes } = await client.request<{ findNodes: { hits: Array<{ node: NodeChoice }> } }>(NODE_CHOICES_QUERY, {
      memoryId,
      query: query || null,
      limit: NODE_CHOICES_PAGE,
      offset,
    });
    // hasMore reads the RAW page length, never the filtered items: this
    // function's own shape-guard drops rows, and a drop must not be able to
    // masquerade as end-of-data (hrn:node:hadronmemory.com:hadron-portal:review:short-page-is-not-end-of-data).
    const raw = findNodes?.hits ?? [];
    const items = raw.map((hit) => hit.node).filter((node): node is NodeChoice => !!node && typeof node.id === 'string' && typeof node.urn === 'string');
    return { kind: 'ok', value: { items, hasMore: raw.length === NODE_CHOICES_PAGE } };
  } catch {
    return { kind: 'failed' };
  }
}
