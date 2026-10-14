import { t } from '$lib/i18n/t';
import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { AGENT_DEFINITION_QUERY } from '$lib/server/agent-inheritance';
import type { AgentOrigin } from '$lib/agent-inheritance';
import type { PageServerLoad } from './$types';

export const DEFINITION_AGENT_QUERY = /* GraphQL */ `
  query DefinitionAgent($ref: ID!) { agent(ref: $ref) { id name urn systemMemoryId } }
`;

// A node's own URN names its base memory. Keep the child context in this URL
// and scope the loc on the server; a base PK/URN bypasses effective-memory reads.
export const load: PageServerLoad = async ({ locals, params }) => {
  const client = gqlClient(locals.token);
  const { agent } = await client.request<{ agent: { id: string; name: string; urn: string; systemMemoryId: string | null } | null }>(DEFINITION_AGENT_QUERY, { ref: params.id });
  if (!agent?.systemMemoryId) error(404, t('agent.definitions.memory-missing', 'Agent system memory not found'));
  const { node } = await client.request<{ node: { id: string; loc: string; name: string; urn: string; content: string | null; inheritedFrom: AgentOrigin | null } | null }>(AGENT_DEFINITION_QUERY, { ref: params.loc, memoryRef: agent.systemMemoryId });
  if (!node) error(404, t('agent.definitions.node-missing', 'Node not found'));
  return { agent, node };
};
