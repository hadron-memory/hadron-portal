import type { GraphQLClient } from 'graphql-request';
import { CHAT_EFFECTIVE_TOOL_CHOICE_QUERY, CHAT_TOOL_CHOICE_FOR_QUERY } from '$lib/server/queries';

export type ChatToolChoice = 'AUTO' | 'FORCED';
type DecisionField = 'chatEffectiveToolChoice' | 'chatToolChoiceFor';

/**
 * Only the old server's unknown ROOT FIELD is absence; read refusals/transport errors still fail.
 *
 * The text match is graphql-js's own validation message, `Cannot query field "<f>" on type "Query".`
 * It is pinned on purpose (agentChatTurn.toolChoice.test.ts): if graphql-js rewords it, an old server
 * stops reading as absent and the turn fails closed, never open. The structural guards (no `path`,
 * validation code or none) keep an ordinary resolver error from ever matching.
 */
function missingDecisionField(error: unknown, field: DecisionField): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const errors = (error as { response?: { errors?: unknown } }).response?.errors;
  return Array.isArray(errors) && errors.length > 0 && errors.every(e =>
    e !== null && typeof e === 'object' && typeof e.message === 'string' &&
    e.message.startsWith(`Cannot query field "${field}" on type "Query".`) &&
    e.path == null && (e.extensions?.code === undefined || e.extensions.code === 'GRAPHQL_VALIDATION_FAILED'));
}

async function decision(client: Pick<GraphQLClient, 'request'>, query: string, variables: Record<string, string>, field: DecisionField): Promise<ChatToolChoice> {
  try {
    const result = await client.request<Record<string, unknown>>(query, variables);
    // Null means no effective config. Missing/unknown values must never opt a request into auto.
    return result[field] === 'AUTO' ? 'AUTO' : 'FORCED';
  } catch (error) {
    if (missingDecisionField(error, field)) return 'FORCED';
    throw error;
  }
}

export const chatEffectiveToolChoice = (client: Pick<GraphQLClient, 'request'>, chatId: string) =>
  decision(client, CHAT_EFFECTIVE_TOOL_CHOICE_QUERY, { chatId }, 'chatEffectiveToolChoice');

export const chatToolChoiceFor = (client: Pick<GraphQLClient, 'request'>, provider: string, model: string) =>
  decision(client, CHAT_TOOL_CHOICE_FOR_QUERY, { provider, model }, 'chatToolChoiceFor');
