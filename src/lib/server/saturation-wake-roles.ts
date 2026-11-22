/**
 * portal#2464 (hadron-server#4777, hrn:node:hadronmemory.com:specs:cor:agt:060:16): the read of the App's
 * saturation-alarm wake roles, as three states a page must keep apart.
 *
 *   ok      the list (empty is a real answer: nobody is woken)
 *   hidden  APP_NOT_FOUND. The roster's refusal, byte for byte, is the same answer for a non-participant and
 *           for an App that is gone, so the setting is absent. It is never read as "App deleted".
 *   failed  anything else: the read did not answer. Said so, never shown as an empty list.
 */
import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from '$lib/gql-error';
import { APP_SATURATION_ALARM_WAKE_ROLES_QUERY } from '$lib/server/queries';

export type WakeRolesRead = { kind: 'ok'; roles: string[] } | { kind: 'hidden' } | { kind: 'failed' };

export async function loadSaturationAlarmWakeRoles(client: Pick<GraphQLClient, 'request'>, appRef: string): Promise<WakeRolesRead> {
  try {
    const r = await client.request<{ saturationAlarmWakeRoles: { roles: string[] } }>(APP_SATURATION_ALARM_WAKE_ROLES_QUERY, { appRef });
    return { kind: 'ok', roles: r.saturationAlarmWakeRoles.roles };
  } catch (e) {
    return extractGqlErrorCode(e) === 'APP_NOT_FOUND' ? { kind: 'hidden' } : { kind: 'failed' };
  }
}
