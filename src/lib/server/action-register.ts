import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import type { RegisterPage } from '$lib/action-register/present';

/**
 * portal#1649 — the action-register reads (hadron-server#3287 / #3312).
 *
 * One `actionRegisterIndex` request per page. The portal ALWAYS sends
 * `agentRef`: a person has no Agent of their own, so there is no default to
 * lean on (ruling 0106 A). Three outcomes are kept apart from an empty page
 * and from each other, because the server deliberately does not explain an
 * empty one (ruling 0107 A): the App is not there for this viewer, the asking
 * Agent can't be used for this App, and a failure.
 */
export const ACTION_REGISTER_INDEX_QUERY = /* GraphQL */ `
  query ActionRegisterIndex($appRef: ID!, $agentRef: ID, $taskLoc: String, $code: String, $limit: Int, $offset: Int) {
    actionRegisterIndex(appRef: $appRef, agentRef: $agentRef, taskLoc: $taskLoc, code: $code, limit: $limit, offset: $offset) {
      total
      hasMore
      entries { code state taskLoc taskUrn definedBy entryUrn actionUrn }
    }
  }
`;

export type IndexRead =
  | { kind: 'ok'; page: RegisterPage }
  | { kind: 'app-not-found' }
  | { kind: 'agent-not-found' }
  | { kind: 'failed' };

export interface IndexArgs {
  appRef: string;
  agentRef: string;
  taskLoc?: string | null;
  code?: string | null;
  limit: number;
  offset: number;
}

export async function loadActionRegisterIndex(client: Pick<GraphQLClient, 'request'>, a: IndexArgs): Promise<IndexRead> {
  if (!a.agentRef) throw new Error('actionRegisterIndex needs an agentRef: the portal never sends without an asking Agent');
  try {
    const r = await client.request<{ actionRegisterIndex: RegisterPage | null }>(ACTION_REGISTER_INDEX_QUERY, {
      appRef: a.appRef,
      agentRef: a.agentRef,
      taskLoc: a.taskLoc ?? null,
      code: a.code ?? null,
      limit: a.limit,
      offset: a.offset,
    });
    if (!r.actionRegisterIndex) return { kind: 'failed' };
    return { kind: 'ok', page: r.actionRegisterIndex };
  } catch (e) {
    const code = extractGqlErrorCode(e);
    if (code === 'APP_NOT_FOUND') return { kind: 'app-not-found' };
    if (code === 'AGENT_NOT_FOUND') return { kind: 'agent-not-found' };
    console.warn(`[action-register] index read failed for ${a.appRef}:`, e);
    return { kind: 'failed' };
  }
}

export interface AgentOption {
  id: string;
  name: string;
  urn: string;
  description?: string | null;
}

const WORKER_PAGE = 200;

export const APP_AGENT_OPTIONS_QUERY = /* GraphQL */ `
  query ActionRegisterAgentOptions($ref: ID!, $appRef: ID!, $limit: Int) {
    app(ref: $ref) { appAgents { agent { id name urn description } } }
    workers(appRef: $appRef, limit: $limit) { total items { agent { id name urn description } } }
  }
`;

export type AgentOptionsRead = { kind: 'ok'; agents: AgentOption[]; partial: boolean } | { kind: 'failed' };

/**
 * The App tab's asking-Agent choices: the App's installed Agents and the Agents
 * of its cast workers (ruling 0106 A), once each. An Agent withheld from this
 * viewer is left out. `partial` is true when the worker read was cut short, so
 * the page can say the list may be incomplete instead of presenting it whole.
 */
export async function loadAppAgentOptions(client: Pick<GraphQLClient, 'request'>, appRef: string): Promise<AgentOptionsRead> {
  try {
    const r = await client.request<{
      app: { appAgents: { agent: AgentOption | null }[] } | null;
      workers: { total: number; items: { agent: AgentOption | null }[] };
    }>(APP_AGENT_OPTIONS_QUERY, { ref: appRef, appRef, limit: WORKER_PAGE });
    const seen = new Map<string, AgentOption>();
    for (const a of [...(r.app?.appAgents ?? []).map((x) => x.agent), ...(r.workers?.items ?? []).map((x) => x.agent)]) {
      if (a && !seen.has(a.id)) seen.set(a.id, a);
    }
    return { kind: 'ok', agents: [...seen.values()], partial: (r.workers?.total ?? 0) > (r.workers?.items.length ?? 0) };
  } catch (e) {
    console.warn(`[action-register] agent options read failed for ${appRef}:`, e);
    return { kind: 'failed' };
  }
}

export interface AppOption {
  id: string;
  name: string;
  urn: string;
}

export const AGENT_APP_OPTIONS_QUERY = /* GraphQL */ `
  query ActionRegisterAppOptions($ref: ID!) {
    agent(ref: $ref) { id apps { id name urn } }
  }
`;

export type AppOptionsRead = { kind: 'ok'; apps: AppOption[] } | { kind: 'failed' };

/**
 * The definition view's App choices: the Apps this Agent is installed in that
 * the viewer can read (the server scopes `Agent.apps` to the caller's orgs).
 * An unreadable Agent has no options. Nothing here guesses an App.
 */
export async function loadAgentAppOptions(client: Pick<GraphQLClient, 'request'>, agentRef: string): Promise<AppOptionsRead> {
  try {
    const r = await client.request<{ agent: { id: string; apps: AppOption[] } | null }>(AGENT_APP_OPTIONS_QUERY, { ref: agentRef });
    const seen = new Map<string, AppOption>();
    for (const a of r.agent?.apps ?? []) if (!seen.has(a.id)) seen.set(a.id, a);
    return { kind: 'ok', apps: [...seen.values()] };
  } catch (e) {
    console.warn(`[action-register] app options read failed for ${agentRef}:`, e);
    return { kind: 'failed' };
  }
}
