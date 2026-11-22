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
    if (code === 'BAD_USER_INPUT') return { kind: 'invalid' };
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
    if (!DAY.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) out.malformed = true;
    else out[key] = `${v}T00:00:00.000Z`;
  }
  return out;
}
