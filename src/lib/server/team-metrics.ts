import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { TEAM_METRICS_QUERY } from '$lib/server/queries';
import type { TeamMetrics, TeamMetricsView } from '$lib/team-metrics/types';

/**
 * portal#1856: one `teamMetrics` read. The server's answer is returned untouched, and the
 * window is passed only when the reader chose one: an omitted window is the SERVER's default
 * (last 7 days), shown from the `window` it returns, never defaulted here.
 */
export async function loadTeamMetrics(
  client: GraphQLClient,
  appRef: string,
  window: { since?: string; until?: string } = {},
): Promise<TeamMetricsView> {
  const view = await readTeamMetrics(client, appRef, window);
  // The window only applies to Flow: keep the rest of the page and refuse beside the form. The
  // retry is one read, never a loop: a second refusal leaves the input error alone.
  if (view.kind === 'invalid') {
    // No window was sent, so the refusal cannot be about one: no retry to make.
    if (!window.since && !window.until) return view;
    const base = await readTeamMetrics(client, appRef, {});
    // A fallback that is hidden or an outage is that state, never an input error over nothing.
    if (base.kind === 'hidden' || base.kind === 'failed') return base;
    return { kind: 'invalid', metrics: base.kind === 'ok' ? base.metrics : null };
  }
  return view;
}

async function readTeamMetrics(
  client: GraphQLClient,
  appRef: string,
  window: { since?: string; until?: string },
): Promise<TeamMetricsView> {
  try {
    const r = await client.request<{ teamMetrics: TeamMetrics | null }>(TEAM_METRICS_QUERY, {
      appRef,
      ...(window.since ? { since: window.since } : {}),
      ...(window.until ? { until: window.until } : {}),
    });
    if (!r.teamMetrics || !r.teamMetrics.workers || !r.teamMetrics.window) return { kind: 'failed' };
    return { kind: 'ok', metrics: r.teamMetrics };
  } catch (e) {
    const code = extractGqlErrorCode(e);
    // One answer for every reason the server withholds the App; never an empty dashboard.
    if (code === 'APP_NOT_FOUND' || code === 'FORBIDDEN' || code === 'NOT_FOUND') return { kind: 'hidden' };
    if (code === 'BAD_USER_INPUT') return { kind: 'invalid', metrics: null };
    console.warn(`[team-metrics] read failed (${code ?? 'transport'})`);
    return { kind: 'failed' };
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `?since=YYYY-MM-DD&until=YYYY-MM-DD` to the instants the server takes (UTC midnight); anything else is dropped. */
export function windowFromParams(params: URLSearchParams): { since?: string; until?: string; malformed: boolean } {
  const out: { since?: string; until?: string; malformed: boolean } = { malformed: false };
  for (const key of ['since', 'until'] as const) {
    const v = params.get(key);
    if (v === null || v === '') continue;
    const ms = Date.parse(`${v}T00:00:00Z`);
    // An impossible day (2026-02-31) would roll over to March; refuse it, never guess.
    if (!DAY.test(v) || Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== v) out.malformed = true;
    else out[key] = `${v}T00:00:00.000Z`;
  }
  return out;
}
