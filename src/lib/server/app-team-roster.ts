import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { APP_TEAM_ROSTER_QUERY } from '$lib/server/queries';

/**
 * portal#1168 (hadron-server#2178) — what the AI Team grid shows beyond the
 * workers themselves: the worker's current task and whether it is paused.
 *
 * ONE bulk `teamRoster` read for the App, joined to the staff by worker id: no
 * read per row. "Paused" is the server's own `checkStatus` (pendingReason
 * PAUSED / TEAM_PAUSED / STOPPED at the roster's asOf), never
 * `pausedUntil > now` computed here, because `pausedUntil` keeps expired
 * history.
 *
 * Classified like the key inventory (hrn:node:hadronmemory.com:hadron-portal:findings:audience-gated-field-on-shared-fragment-nulls-parent):
 * a refusal is `hidden`, an outage is `failed`, and neither is ever an empty
 * roster, so "no task" is only ever said about a worker the server answered
 * for. Never throws; logs no server text.
 */
export type RosterEntry = {
  worker: { id: string };
  checkStatus: { status: string; pendingReason: string | null } | null;
  pausedUntil: string | null;
  currentTask: { id: string; title: string; status: string } | null;
};

export type TeamRosterRead =
  | { kind: 'ok'; byWorker: Record<string, RosterEntry> }
  | { kind: 'hidden' }
  | { kind: 'failed' };

export async function loadAppTeamRoster(client: GraphQLClient, appRef: string): Promise<TeamRosterRead> {
  try {
    const r = await client.request<{ teamRoster: { workers: RosterEntry[] } }>(APP_TEAM_ROSTER_QUERY, { appRef });
    const byWorker: Record<string, RosterEntry> = {};
    for (const w of r.teamRoster.workers) byWorker[w.worker.id] = w;
    return { kind: 'ok', byWorker };
  } catch (e) {
    const code = extractGqlErrorCode(e);
    if (code === 'APP_NOT_FOUND' || code === 'FORBIDDEN') return { kind: 'hidden' };
    console.warn(`[app-team-roster] roster read for ${appRef} failed (${code ?? 'transport'})`);
    return { kind: 'failed' };
  }
}
