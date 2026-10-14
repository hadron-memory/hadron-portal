import type { GraphQLClient } from 'graphql-request';
import type { AgentBaseRead, DefinitionEntry, DefinitionRead } from '$lib/agent-inheritance';
import { extractGqlError } from './gqlError';
import { t } from '$lib/i18n/t';

export const AGENT_BASE_QUERY = /* GraphQL */ `
  query AgentBase($ref: ID!) { agent(ref: $ref) { extendsAgentId } }
`;
export const BASE_AGENT_IDENTITY_QUERY = /* GraphQL */ `
  query BaseAgentIdentity($ref: ID!) { agent(ref: $ref) { id name urn } }
`;
export const AGENT_TASK_LIST_QUERY = /* GraphQL */ `
  query AgentTaskList($ref: ID!) {
    agentTaskList(ref: $ref) { trigger node { id memoryId loc name urn inheritedFrom { agentId agentUrn } } }
  }
`;
export const AGENT_PROCESS_LIST_QUERY = /* GraphQL */ `
  query AgentProcessList($ref: ID!) {
    agentProcessList(ref: $ref) { trigger kind node { id memoryId loc name urn inheritedFrom { agentId agentUrn } } }
  }
`;
export const AGENT_DEFINITION_QUERY = /* GraphQL */ `
  query AgentDefinition($ref: ID!, $memoryRef: ID!) {
    node(ref: $ref, memoryRef: $memoryRef) {
      id loc name urn content inheritedFrom { agentId agentUrn }
    }
  }
`;

export async function loadAgentInheritance(client: GraphQLClient, ref: string) {
  const basePromise = client.request<{ agent: { extendsAgentId: string | null } | null }>(AGENT_BASE_QUERY, { ref });
  async function list(query: string, key: 'agentTaskList' | 'agentProcessList'): Promise<DefinitionRead> {
    try {
      const result = await client.request<Record<typeof key, DefinitionEntry[]>>(query, { ref });
      return { items: result[key], error: null };
    } catch (e) {
      return { items: null, error: extractGqlError(e, t('agent.definitions.failed', 'Could not load definitions')) };
    }
  }
  const tasksPromise = list(AGENT_TASK_LIST_QUERY, 'agentTaskList');
  const processesPromise = list(AGENT_PROCESS_LIST_QUERY, 'agentProcessList');
  let base: AgentBaseRead;
  try {
    const { agent } = await basePromise;
    if (!agent) throw new Error(t('agent.base.agent-unavailable', 'Agent details are unavailable.'));
    const id = agent.extendsAgentId;
    base = { id, agent: null, error: null };
    if (id) {
      try {
        base.agent = (await client.request<{ agent: AgentBaseRead['agent'] }>(BASE_AGENT_IDENTITY_QUERY, { ref: id })).agent;
      } catch (e) {
        base.error = extractGqlError(e, t('agent.base.failed', 'Could not load base Agent'));
      }
    }
  } catch (e) {
    base = { id: null, agent: null, error: extractGqlError(e, t('agent.base.failed', 'Could not load base Agent')) };
  }
  return { base, tasks: await tasksPromise, processes: await processesPromise };
}
