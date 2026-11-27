/**
 * portal#1649 — the App's action-register index, as a section of Settings: which code sends work to which role task
 * (hadron-server#3287, hrn:node:hadronmemory.com:specs:cor:agt:110:03). Read only.
 * Read only when the section is asked for (the URL names it, or the reader unfolds it).
 *
 * The ASKING Agent is the viewer's choice, kept in the page URL as `registerAgent` (with `registerLimit` and
 * `registerOffset` for paging; the section's own names, because the page's other lists use `offset`): with none
 * chosen no query is sent, because "choose an Agent" is not an empty index. The two reads classify their own failures,
 * so a refusal of the App is a state of the section, never the App page's 404 (the App read gates every tab).
 */
import type { GraphQLClient } from 'graphql-request';
import { loadActionRegisterIndex, loadAppAgentOptions, type AgentOption, type AgentOptionsRead, type IndexRead } from '$lib/server/action-register';
import { parseLimit, parseOffset } from '$lib/action-register/present';

export async function loadRegisterPanel(want: boolean, client: GraphQLClient, appId: string, params: URLSearchParams) {
  if (!want) return null;
  const agentRef = (params.get('registerAgent') ?? '').trim();
  const limit = parseLimit(params.get('registerLimit'));
  const offset = parseOffset(params.get('registerOffset'));

  const [options, found]: [AgentOptionsRead, IndexRead | null] = await Promise.all([
    loadAppAgentOptions(client, appId),
    agentRef ? loadActionRegisterIndex(client, { appRef: appId, agentRef, limit, offset }) : Promise.resolve(null),
  ]);
  // The old page answered a non-participant APP_NOT_FOUND as a 404; the App page has already gated this one.
  const index: IndexRead | null = found?.kind === 'app-not-found' ? { kind: 'failed' } : found;

  const chosen: AgentOption | null = agentRef
    ? (options.kind === 'ok' ? options.agents.find((a) => a.id === agentRef || a.urn === agentRef) : undefined) ?? { id: agentRef, name: agentRef, urn: agentRef.startsWith('hrn:') ? agentRef : '' }
    : null;

  return { options, agentRef, chosen, index, limit, offset };
}
