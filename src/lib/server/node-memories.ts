import type { GraphQLClient } from 'graphql-request';
import { MEMORIES_QUERY } from '$lib/server/queries';
import { fetchAllItems } from '$lib/server/paginate';
import type { MemoriesRead, MemoryChoice } from '$lib/node-choices';

/**
 * The memories a node picker's first stage offers: the viewer's readable memories, STREAMED so the page never waits on
 * them. A failed read reaches the picker as a FAILURE value, never as [] (portal#1585: an empty list made "the read
 * failed" read as "you can read nothing") and never as a rejection (portal#1588: a rejecting stream fires an
 * uncaught page error during kit's parse-time deserialization, before a component can attach a handler).
 */
export function loadNodeMemories(client: GraphQLClient, where: string): Promise<MemoriesRead> {
  return fetchAllItems<MemoryChoice>(client, MEMORIES_QUERY, 'memories').then(
    (memories): MemoriesRead => ({ kind: 'ok', value: memories }),
    (e): MemoriesRead => {
      console.warn(`[${where}] node-picker memory list failed:`, e);
      return { kind: 'failed' };
    },
  );
}
