import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { loadActionRegisterIndex, loadAppAgentOptions, type AgentOption, type AgentOptionsRead, type IndexRead } from '$lib/server/action-register';
import { parseLimit, parseOffset } from '$lib/action-register/present';
import type { PageServerLoad } from './$types';

/**
 * portal#1649 — the App's action-register index: which code sends work to
 * which role task (hadron-server#3287, cor:agt:110:03). Read only.
 *
 * Its own sub-route, like Tasks and Stops, so a read that answers a
 * non-participant APP_NOT_FOUND never reaches the App page's loader. The
 * ASKING Agent is the viewer's choice, kept in `?agent=`; with none chosen no
 * query is sent, because "choose an Agent" is not an empty index.
 */
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const client = gqlClient(locals.token);
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');

  const agentRef = (url.searchParams.get('agent') ?? '').trim();
  const limit = parseLimit(url.searchParams.get('limit'));
  const offset = parseOffset(url.searchParams.get('offset'));

  const [options, index]: [AgentOptionsRead, IndexRead | null] = await Promise.all([
    loadAppAgentOptions(client, app.id),
    agentRef ? loadActionRegisterIndex(client, { appRef: app.id, agentRef, limit, offset }) : Promise.resolve(null),
  ]);
  if (index?.kind === 'app-not-found') throw error(404, 'App not found');

  const chosen: AgentOption | null = agentRef
    ? (options.kind === 'ok' ? options.agents.find((a) => a.id === agentRef || a.urn === agentRef) : undefined) ?? { id: agentRef, name: agentRef, urn: agentRef.startsWith('hrn:') ? agentRef : '' }
    : null;

  return {
    app,
    options,
    agentRef,
    chosen,
    index,
    limit,
    offset,
    // The request this answer is for: a view that finds it differs from the URL
    // it is showing discards the answer instead of drawing it under new controls.
    key: `${app.id}|${agentRef}|${limit}|${offset}`,
  };
};
