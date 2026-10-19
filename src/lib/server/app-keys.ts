import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { mapWithConcurrency } from '$lib/server/concurrency';
import { APP_KEYS_QUERY } from '$lib/server/queries';
import type { AppKey } from '$lib/types';

/**
 * portal#1068 — an App's key inventory, in its OWN request.
 *
 * `App.keys` is manager-only and non-null on the server (hadron-server#2080:
 * hrn:node:hadronmemory.com:specs:cor:dmo:050:05, "nobody else sees the App's
 * keys at all"), so a field error there nulls the enclosing App. Selected on
 * the shared App fragment it took down the App page, the org Apps list and
 * every Organizations consumer for a viewer who is not a manager. Here a
 * refusal is a STATE: `hidden` for FORBIDDEN, `failed` for anything else, and
 * neither is ever an empty list or a zero
 * (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only).
 * Never throws; logs no server text and no key id.
 */
export type KeysRead = { kind: 'ok'; keys: AppKey[] } | { kind: 'hidden' } | { kind: 'failed' };

/** `unknown` is an App past the cap: not asked, so neither a count nor a refusal. */
export type KeyCountRead = { kind: 'ok'; count: number } | { kind: 'hidden' } | { kind: 'failed' } | { kind: 'unknown' };

export const ACTIVE_KEY_COUNT_CAP = 100;
export const ACTIVE_KEY_COUNT_CONCURRENCY = 5;

export async function loadAppKeys(client: GraphQLClient, appRef: string): Promise<KeysRead> {
  try {
    const r = await client.request<{ appKeys: AppKey[] }>(APP_KEYS_QUERY, { appRef });
    return { kind: 'ok', keys: r.appKeys };
  } catch (e) {
    if (extractGqlErrorCode(e) === 'FORBIDDEN') return { kind: 'hidden' };
    console.warn(`[app-keys] key read for ${appRef} failed (${extractGqlErrorCode(e) ?? 'transport'})`);
    return { kind: 'failed' };
  }
}

/**
 * The org Apps page's "Active keys" column: one classified request per App
 * (so one refusal cannot null the others), `ACTIVE_KEY_COUNT_CONCURRENCY` in
 * flight, the first `ACTIVE_KEY_COUNT_CAP` Apps asked. The server returns only
 * live keys, so the count is the list length.
 */
export async function loadActiveKeyCounts(
  client: GraphQLClient,
  apps: readonly { id: string }[],
): Promise<Record<string, KeyCountRead>> {
  const asked = apps.slice(0, ACTIVE_KEY_COUNT_CAP);
  const reads = await mapWithConcurrency(asked, ACTIVE_KEY_COUNT_CONCURRENCY, (app) => loadAppKeys(client, app.id));
  const out: Record<string, KeyCountRead> = {};
  asked.forEach((app, i) => {
    const r = reads[i];
    out[app.id] = r.kind === 'ok' ? { kind: 'ok', count: r.keys.length } : { kind: r.kind };
  });
  for (const app of apps.slice(ACTIVE_KEY_COUNT_CAP)) out[app.id] = { kind: 'unknown' };
  return out;
}
