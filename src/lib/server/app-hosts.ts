import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { APP_HOST_REGISTRATIONS_QUERY } from '$lib/server/queries';

/** One row of the host picker. */
export type AppHost = { hostId: string; label: string; live: boolean };

/**
 * portal#2311 — the App's registered hosts, classified. A refusal is `refused`
 * and an outage is `failed`; neither is ever an empty list, so "no hosts are
 * registered" is only said about a reader the server answered for
 * (hrn:node:hadronmemory.com:specs:cor:agt:050:21 gates the read). Never throws
 * and carries no server text.
 */
export type AppHostsRead = { kind: 'ok'; hosts: AppHost[] } | { kind: 'refused' } | { kind: 'failed' };

export async function loadAppHosts(client: GraphQLClient, appRef: string): Promise<AppHostsRead> {
  try {
    const r = await client.request<{ hostRegistrations: AppHost[] }>(APP_HOST_REGISTRATIONS_QUERY, { appRef });
    const hosts = r.hostRegistrations
      .map((x) => ({ hostId: x.hostId, label: x.label, live: x.live }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.hostId.localeCompare(b.hostId));
    return { kind: 'ok', hosts };
  } catch (e) {
    if (extractGqlErrorCode(e) === 'FORBIDDEN') return { kind: 'refused' };
    console.warn(`[app-hosts] host read for ${appRef} failed:`, e);
    return { kind: 'failed' };
  }
}
