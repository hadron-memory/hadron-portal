import type { GraphQLClient } from 'graphql-request';
import { loadActionRegisterIndex, loadAgentAppOptions } from '$lib/server/action-register';
import { parseLimit, parseOffset } from '$lib/action-register/present';
import type { DefinitionRegister } from '$lib/action-register/definition';

/**
 * portal#1649 — the definition page's "Codes for this task loc" read.
 *
 * Asking Agent: the route's own Agent (this is resolution for the displayed
 * context, not a claim that it owns an inherited node). App: only the one the
 * viewer chose, or the only one there is; never a guess from a node, a memory
 * or a first installation. One filtered request per page (`taskLoc` = this
 * definition's loc). Nothing here may throw: a refusal or failure is this
 * section's state, and the definition page above stays valid.
 */
export async function loadDefinitionRegister(
  client: Pick<GraphQLClient, 'request'>,
  input: { agentId: string; node: { loc: string; urn: string }; params: URLSearchParams },
): Promise<DefinitionRegister> {
  const opts = await loadAgentAppOptions(client, input.agentId);
  if (opts.kind === 'failed') return { kind: 'options-failed' };
  if (opts.apps.length === 0) return { kind: 'unavailable' };

  const limit = parseLimit(input.params.get('limit'));
  const offset = parseOffset(input.params.get('offset'));
  const asked = (input.params.get('app') ?? '').trim();
  const app = opts.apps.length === 1 ? opts.apps[0] : (opts.apps.find((a) => a.id === asked || a.urn === asked) ?? null);

  const index = app
    ? await loadActionRegisterIndex(client, { appRef: app.id, agentRef: input.agentId, taskLoc: input.node.loc, limit, offset })
    : null;
  return { kind: 'ready', apps: opts.apps, app, appId: app?.id ?? null, index, limit, offset, definitionUrn: input.node.urn };
}
