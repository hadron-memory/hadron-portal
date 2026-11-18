import type { GraphQLClient } from 'graphql-request';
import { t } from '$lib/i18n/t';
import type { WriteRefusal } from '$lib/agent-tasks/actions';
import { IMPERSONATION_SENTENCE } from '$lib/server/agent-task-writes';
import type { AgentTickerTemplate, AgentTickerTemplates, TickerRead } from '$lib/tickers/types';

/**
 * portal#1609 (slice C of #1141) — an Agent's ticker templates, as
 * hadron-server #2024 ships them (hrn:node:hadronmemory.com:specs:cor:agt:080:33).
 *
 * Reading is whoever can read the Agent. Writing is whoever manages the Agent
 * (hrn:node:hadronmemory.com:specs:cor:agt:080:35): an App manager is not thereby an Agent editor, and a worker
 * session is refused. `viewerMayEditTickerTemplates` is a display hint only;
 * the server decides every write with the viewer's own token.
 *
 * A template is a snapshot source: an edit reaches only FUTURE casts
 * (hrn:node:hadronmemory.com:specs:cor:agt:080:34), and the page says so beside the form.
 */

export const AGENT_TICKER_TEMPLATES_QUERY = /* GraphQL */ `
  query AgentTickerTemplates($ref: ID!) {
    agent(ref: $ref) {
      id
      viewerMayEditTickerTemplates
      tickerTemplates { id name cadenceSeconds quietHours reasons relevance revision tickCode updatedAt }
    }
  }
`;

export const CREATE_AGENT_TICKER_TEMPLATE_MUTATION = /* GraphQL */ `
  mutation CreateAgentTickerTemplate($agentRef: String!, $input: AgentTickerTemplateInput!) {
    createAgentTickerTemplate(agentRef: $agentRef, input: $input) { id revision }
  }
`;

export const UPDATE_AGENT_TICKER_TEMPLATE_MUTATION = /* GraphQL */ `
  mutation UpdateAgentTickerTemplate($id: ID!, $expectedRevision: Int!, $input: AgentTickerTemplatePatch!) {
    updateAgentTickerTemplate(id: $id, expectedRevision: $expectedRevision, input: $input) { id revision }
  }
`;

export const DELETE_AGENT_TICKER_TEMPLATE_MUTATION = /* GraphQL */ `
  mutation DeleteAgentTickerTemplate($id: ID!, $expectedRevision: Int!) {
    deleteAgentTickerTemplate(id: $id, expectedRevision: $expectedRevision)
  }
`;

export async function loadAgentTickerTemplates(client: GraphQLClient, agentRef: string): Promise<TickerRead<AgentTickerTemplates>> {
  try {
    const r = await client.request<{
      agent: { viewerMayEditTickerTemplates?: unknown; tickerTemplates?: unknown } | null;
    }>(AGENT_TICKER_TEMPLATES_QUERY, { ref: agentRef });
    if (!r.agent || !Array.isArray(r.agent.tickerTemplates)) {
      console.warn(`[agent-ticker-templates] read for ${agentRef} returned no templates`);
      return { kind: 'failed' };
    }
    // Only a literal true is a yes; false, null and anything odd show no controls and no error.
    const cap = r.agent.viewerMayEditTickerTemplates;
    return {
      kind: 'ok',
      value: {
        viewerMayEdit: cap === true ? true : cap === false ? false : null,
        templates: r.agent.tickerTemplates as AgentTickerTemplate[],
      },
    };
  } catch (e) {
    console.warn(`[agent-ticker-templates] read for ${agentRef} failed:`, e);
    return { kind: 'failed' };
  }
}

export type TemplateWriteAction = 'create' | 'update' | 'delete';

/** Codes whose sentence is the server's own, written for people and raised before anything is stored. */
const SERVER_SENTENCE_CODES = new Set([
  'BAD_USER_INPUT',
  'TICKER_TEMPLATE_NAME_TAKEN',
  'TICKER_TEMPLATE_LIMIT_REACHED',
  'TICKER_CADENCE_OUT_OF_RANGE',
  'TICKER_QUIET_HOURS_INVALID',
  'AGENT_NOT_FOUND',
]);

export const notFoundText = () =>
  t('agent.tickers.write.not-found', 'This template no longer exists, so nothing was changed. Reload to see the current list.');

export const staleRevisionText = () =>
  t('agent.tickers.write.stale', 'This template was changed by someone else since you opened it, so nothing was saved. Reload to see the latest version; what you typed stays here until you do.');

function forbiddenSentence(action: TemplateWriteAction): string {
  switch (action) {
    case 'create':
      return t('agent.tickers.write.forbidden.create', 'You can’t add a ticker to this Agent. Only whoever manages the Agent can; managing an App it is installed in is not enough.');
    case 'update':
      return t('agent.tickers.write.forbidden.update', 'You can’t change this Agent’s tickers. Only whoever manages the Agent can; managing an App it is installed in is not enough.');
    case 'delete':
      return t('agent.tickers.write.forbidden.delete', 'You can’t delete this Agent’s tickers. Only whoever manages the Agent can; managing an App it is installed in is not enough.');
  }
}

export function classifyTemplateError(e: unknown, action: TemplateWriteAction): WriteRefusal {
  if (!e || typeof e !== 'object' || !('response' in e)) return { kind: 'uncertain' };
  const first = (e as { response?: { errors?: { message?: unknown; extensions?: { code?: unknown } }[] } }).response?.errors?.[0];
  const code = typeof first?.extensions?.code === 'string' ? first.extensions.code : null;
  const message = typeof first?.message === 'string' ? first.message : null;
  if (!code || !message) return { kind: 'uncertain' };
  if (SERVER_SENTENCE_CODES.has(code)) return { kind: 'refused', code, message };
  if (code === 'TICKER_TEMPLATE_REVISION_MISMATCH') return { kind: 'refused', code, message: staleRevisionText() };
  if (code === 'TICKER_TEMPLATE_NOT_FOUND') return { kind: 'refused', code, message: notFoundText() };
  if (code === 'FORBIDDEN') {
    return { kind: 'refused', code, message: message === IMPERSONATION_SENTENCE ? message : forbiddenSentence(action) };
  }
  return { kind: 'uncertain' };
}
