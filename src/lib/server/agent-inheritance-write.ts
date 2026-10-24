import type { GraphQLClient } from 'graphql-request';
import { extractGqlError } from './gqlError';
import { fetchOwnedAgents } from './personal-agents';
import { APP_ORG_AGENTS_QUERY } from './queries';
import { t } from '$lib/i18n/t';

export const SELF_AGENT_MANAGE_QUERY = /* GraphQL */ `
  query SelfAgentManage($resource: ID!, $user: ID!) {
    effectiveAccess(resource: $resource, user: $user) { canManage }
  }
`;
export const AGENT_INDEX_REFS_QUERY = /* GraphQL */ `
  query AgentIndexRefs($ref: ID!) { agent(ref: $ref) { extendsAgentId tasksIndexRef processesIndexRef } }
`;
export const INDEX_NODE_IDENTITY_QUERY = /* GraphQL */ `
  query IndexNodeIdentity($ref: ID!) { node(ref: $ref) { urn name } }
`;
export const SET_AGENT_BASE_MUTATION = /* GraphQL */ `
  mutation SetAgentBase($ref: ID!, $baseRef: ID) {
    setAgentBase(ref: $ref, baseRef: $baseRef) { id }
  }
`;
export const SET_AGENT_INDEX_REFS_MUTATION = /* GraphQL */ `
  mutation SetAgentIndexRefs($ref: ID!, $tasksIndexRef: ID, $processesIndexRef: ID) {
    setAgentIndexRefs(ref: $ref, tasksIndexRef: $tasksIndexRef, processesIndexRef: $processesIndexRef) { id }
  }
`;
export type BaseWrite = { operation: 'set' | 'clear'; baseRef: string };
export type IndexWrite = {
  tasksOperation: 'keep' | 'set' | 'clear'; tasksIndexRef: string;
  processesOperation: 'keep' | 'set' | 'clear'; processesIndexRef: string;
};
export function baseVariables(ref: string, form: BaseWrite) {
  return { ref, baseRef: form.operation === 'clear' ? null : form.baseRef };
}
export function indexVariables(ref: string, form: IndexWrite) {
  return {
    ref,
    ...(form.tasksOperation === 'keep' ? {} : { tasksIndexRef: form.tasksOperation === 'clear' ? null : form.tasksIndexRef }),
    ...(form.processesOperation === 'keep' ? {} : { processesIndexRef: form.processesOperation === 'clear' ? null : form.processesIndexRef }),
  };
}
/** One row the parent-agent SelectAgent modal offers. */
export interface BaseCandidate {
  id: string;
  name: string;
  urn: string;
  description?: string | null;
}

/**
 * #1108: parent-agent picker candidates, already access-scoped by whichever
 * query returns them — an org agent's parents come from the org's
 * member-readable agent list (APP_ORG_AGENTS_QUERY), a personal agent's from
 * the caller's own agents (MY_AGENTS_QUERY, server-side ownedByMe — never an
 * admin-bypass surface). The picker is advisory: setAgentBase eligibility
 * stays authoritative server-side, so this list only needs to avoid OFFERING
 * what the caller cannot even see. Self is filtered (a cycle the server would
 * refuse anyway). Null — not [] — on failure, so the picker says "could not
 * load" instead of pretending there are no candidates.
 */
export async function loadBaseCandidates(
  client: GraphQLClient,
  token: string | null,
  organizationId: string | null,
  selfId: string,
): Promise<BaseCandidate[] | null> {
  try {
    const agents: BaseCandidate[] = organizationId
      ? (await client.request<{ organization: { agents: BaseCandidate[] } | null }>(APP_ORG_AGENTS_QUERY, { ref: organizationId })).organization?.agents ?? []
      : await fetchOwnedAgents(token);
    return agents.filter((a) => a.id !== selfId);
  } catch {
    return null;
  }
}

export interface InheritanceManagement {
  canManage: boolean;
  refs: { extendsAgentId: string | null; tasksIndexRef: string | null; processesIndexRef: string | null } | null;
  tasksNode: { urn: string; name: string } | null;
  processesNode: { urn: string; name: string } | null;
  error: string | null;
}
export async function loadInheritanceManagement(client: GraphQLClient, ref: string, resource: string, user: string | null, impersonating: boolean): Promise<InheritanceManagement> {
  const result: InheritanceManagement = { canManage: false, refs: null, tasksNode: null, processesNode: null, error: null };
  if (!user || impersonating) return result;
  try {
    const access = await client.request<{ effectiveAccess: { canManage: boolean } }>(SELF_AGENT_MANAGE_QUERY, { resource, user });
    if (!access.effectiveAccess.canManage) return result;
    result.canManage = true;
    const { agent } = await client.request<{ agent: InheritanceManagement['refs'] }>(AGENT_INDEX_REFS_QUERY, { ref });
    if (!agent) throw new Error(t('agent.inheritance.unavailable', 'Agent inheritance settings are unavailable.'));
    result.refs = agent;
    const identity = async (id: string | null) => id
      ? (await client.request<{ node: { urn: string; name: string } | null }>(INDEX_NODE_IDENTITY_QUERY, { ref: id }).catch(() => ({ node: null }))).node
      : null;
    [result.tasksNode, result.processesNode] = await Promise.all([identity(agent.tasksIndexRef), identity(agent.processesIndexRef)]);
  } catch (e) {
    result.error = extractGqlError(e, t('agent.inheritance.failed', 'Could not load inheritance settings.'));
  }
  return result;
}
