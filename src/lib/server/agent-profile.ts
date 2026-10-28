import type { GraphQLClient } from 'graphql-request';

export interface AgentIdentity { id: string; name: string; urn: string }
export interface AgentExtensions {
  items: AgentIdentity[];
  endCursor: string | null;
  hasMore: boolean;
  failed: boolean;
}
export const AGENT_EXTENSIONS_QUERY = /* GraphQL */ `
  query AgentExtensions($ref: ID!, $after: String) {
    agent(ref: $ref) {
      extendedBy(first: 20, after: $after) { items { id name urn } endCursor hasMore }
    }
  }
`;
export const AGENT_SYSTEM_MEMORY_IDENTITY_QUERY = /* GraphQL */ `
  query AgentSystemMemoryIdentity($ref: ID!) {
    memory(ref: $ref) { id name urn }
  }
`;

// Read only the canonical reverse relation, never an org-scoped approximation.
// Keep each server page and its opaque cursor intact, including an empty page
// with hasMore: true (the server's bounded authorization scan is incomplete).
export async function loadAgentExtensions(client: GraphQLClient, ref: string, after: string | null): Promise<AgentExtensions> {
  try {
    const result = await client.request<{ agent: { extendedBy: Omit<AgentExtensions, 'failed'> } | null }>(AGENT_EXTENSIONS_QUERY, { ref, after });
    const page = result.agent?.extendedBy;
    if (!page || (page.hasMore && !page.endCursor)) throw new Error('Incomplete extension page');
    return { items: page.items, endCursor: page.endCursor, hasMore: page.hasMore, failed: false };
  } catch {
    return { items: [], endCursor: null, hasMore: false, failed: true };
  }
}

export async function loadSystemMemoryIdentity(client: GraphQLClient, ref: string | null) {
  if (!ref) return null;
  try {
    const { memory } = await client.request<{ memory: AgentIdentity | null }>(AGENT_SYSTEM_MEMORY_IDENTITY_QUERY, { ref });
    return memory ?? null;
  } catch {
    // Unreadable or unavailable: do not guess a URN from the Agent's memory id.
    return null;
  }
}
