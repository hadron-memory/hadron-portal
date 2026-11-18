import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { APP_TEAM_ROSTER_QUERY } from '$lib/server/queries';
import { hydrateTaskRefs } from '$lib/server/agent-tasks';
import type { TerminalRead } from '$lib/workers/terminal';

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
  // portal#1492: null is a returned "no report"; a worker with no entry at all has no terminal to show.
  terminal?: TerminalRead | null;
  // `handle` is not on the server's roster summary; it is hydrated (portal#1349).
  currentTask: { id: string; title: string; status: string; handle?: string | null } | null;
  // portal#1349: the worker HAS a current task, but its hydration did not resolve
  // it in this App (missing, unreadable, another App's, or the read failed).
  // `currentTask` is then null, so no stale title, id or link survives; this flag
  // keeps that apart from a worker the server says has no task.
  currentTaskUnavailable?: true;
  /** hadron-server#2223 — who holds the worker's name. Null for nobody, a deleted
   *  holder, or a reader behind the working-state gate: those three are not told apart. */
  heldBy: RosterHolder | null;
  heldAt: string | null;
};

/** A sanitized holder identity. `name` is null when withheld AND when unset. */
export type RosterHolder = { id: string; handle: string | null; urn: string | null; name: string | null };

export type TeamRosterRead =
  | { kind: 'ok'; byWorker: Record<string, RosterEntry> }
  | { kind: 'hidden' }
  | { kind: 'failed' };

export async function loadAppTeamRoster(client: GraphQLClient, appRef: string): Promise<TeamRosterRead> {
  try {
    const r = await client.request<{ teamRoster: { workers: RosterEntry[] } }>(APP_TEAM_ROSTER_QUERY, { appRef });
    const byWorker: Record<string, RosterEntry> = {};
    for (const w of r.teamRoster.workers) byWorker[w.worker.id] = w;
    // portal#1349: the immutable handle for each current task, through the readable-task gate.
    const refs = await hydrateTaskRefs(client, appRef, Object.values(byWorker).map((w) => w.currentTask?.id));
    for (const w of Object.values(byWorker)) {
      if (!w.currentTask) continue;
      const ref = refs[w.currentTask.id];
      if (ref) w.currentTask = { ...w.currentTask, title: ref.title, handle: ref.handle };
      else {
        w.currentTask = null;
        w.currentTaskUnavailable = true;
      }
    }
    return { kind: 'ok', byWorker };
  } catch (e) {
    const code = extractGqlErrorCode(e);
    if (code === 'APP_NOT_FOUND' || code === 'FORBIDDEN') return { kind: 'hidden' };
    console.warn(`[app-team-roster] roster read for ${appRef} failed (${code ?? 'transport'})`);
    return { kind: 'failed' };
  }
}
