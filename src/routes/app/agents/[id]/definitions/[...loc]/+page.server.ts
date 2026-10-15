import { t } from '$lib/i18n/t';
import { ClientError } from 'graphql-request';
import { error, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { AGENT_DEFINITION_QUERY } from '$lib/server/agent-inheritance';
import type { AgentOrigin } from '$lib/agent-inheritance';
import type { PageServerLoad } from './$types';

const DEFINITION_AGENT_QUERY = /* GraphQL */ `
  query DefinitionAgent($ref: ID!) { agent(ref: $ref) { id name urn systemMemoryId } }
`;

// A node's own URN names its base memory. Keep the child context in this URL
// and scope the loc on the server; a base PK/URN bypasses effective-memory reads.
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const client = gqlClient(locals.token);
  try {
    const { agent } = await client.request<{ agent: { id: string; name: string; urn: string; systemMemoryId: string | null } | null }>(DEFINITION_AGENT_QUERY, { ref: params.id });
    if (!agent?.systemMemoryId) error(404, t('agent.definitions.node-missing', 'Node not found'));
    const { node } = await client.request<{ node: { id: string; loc: string; name: string; urn: string; content: string | null; inheritedFrom: AgentOrigin | null } | null }>(AGENT_DEFINITION_QUERY, { ref: params.loc, memoryRef: agent.systemMemoryId });
    if (!node) error(404, t('agent.definitions.node-missing', 'Node not found'));
    return { agent, node };
  } catch (err) {
    if (err instanceof ClientError && err.response?.errors?.length) {
      const code = err.response.errors[0].extensions?.code;
      if (code === 'UNAUTHENTICATED' || code === 'SESSION_EXPIRED') {
        redirect(303, `/signin?redirect=${encodeURIComponent(url.pathname + url.search)}`);
      }
      // Only known access/missing refusals conceal existence. Unknown codes
      // and transport failures stay distinguishable server errors.
      if (code === 'FORBIDDEN' || code === 'PERMISSION_DENIED' ||
          code === 'NOT_FOUND' || code === 'AGENT_NOT_FOUND' ||
          code === 'MEMORY_NOT_FOUND' || code === 'NODE_NOT_FOUND') {
        error(404, t('agent.definitions.node-missing', 'Node not found'));
      }
    }
    throw err;
  }
};
