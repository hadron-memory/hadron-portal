import type { GraphQLClient } from 'graphql-request';
import { t } from '$lib/i18n/t';
import type { WriteRefusal } from '$lib/agent-tasks/actions';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { IMPERSONATION_SENTENCE } from '$lib/server/agent-task-writes';
import type { AppDeliverySettings, TickerRead } from '$lib/tickers/types';

/**
 * portal#1141 slice A — the App's delivery settings, as hadron-server S9
 * (#2059/#2025) ships them. Kept apart from `tickers.ts`, which holds only
 * the Tickers views' reads (portal#1099).
 *
 * Reading needs participation in the App (a reader outside it gets
 * APP_NOT_FOUND); writing is whoever manages the App, and the server's
 * FORBIDDEN sentence answers anyone else. Neither is inferred here.
 */

export const APP_DELIVERY_SETTINGS_QUERY = /* GraphQL */ `
  query AppDeliverySettings($appRef: String!) {
    appDeliverySettings(appRef: $appRef) { batchWindowSeconds busyDelaySeconds stuckWindowSeconds }
  }
`;

export const SET_APP_DELIVERY_SETTINGS_MUTATION = /* GraphQL */ `
  mutation SetAppDeliverySettings($appRef: String!, $input: AppDeliverySettingsInput!) {
    setAppDeliverySettings(appRef: $appRef, input: $input) { batchWindowSeconds busyDelaySeconds stuckWindowSeconds }
  }
`;

export async function loadAppDeliverySettings(client: GraphQLClient, appRef: string): Promise<TickerRead<AppDeliverySettings>> {
  try {
    const r = await client.request<{ appDeliverySettings: AppDeliverySettings }>(APP_DELIVERY_SETTINGS_QUERY, { appRef });
    return { kind: 'ok', value: r.appDeliverySettings };
  } catch (e) {
    if (extractGqlErrorCode(e) === 'APP_NOT_FOUND') return { kind: 'not-participant' };
    console.warn(`[delivery-settings] read for ${appRef} failed:`, e);
    return { kind: 'failed' };
  }
}

/** The three settings this slice edits. Standby is retired (server#3606, portal#1759): never selected or sent. */
export const DELIVERY_FIELDS_EDITED = ['batchWindowSeconds', 'busyDelaySeconds', 'stuckWindowSeconds'] as const;
export type DeliveryField = (typeof DELIVERY_FIELDS_EDITED)[number];

const GRAPHQL_INT_MAX = 2_147_483_647;

/**
 * The patch a save sends: only the fields whose value differs from the
 * `<field>Was` the form rendered (patch semantics: omitted preserves, null
 * refuses). Whole numbers only; whether one is in range is the server's call,
 * answered in its own sentence, so an out-of-range number is still sent.
 */
export function buildDeliveryPatch(
  fd: FormData,
): { patch: Partial<Record<DeliveryField, number>> } | { invalid: { field: DeliveryField | 'form'; message: string } } {
  const patch: Partial<Record<DeliveryField, number>> = {};
  for (const field of DELIVERY_FIELDS_EDITED) {
    const raw = String(fd.get(field) ?? '').trim();
    const was = String(fd.get(`${field}Was`) ?? '').trim();
    if (raw === was) continue;
    if (!/^\d+$/.test(raw) || Number(raw) > GRAPHQL_INT_MAX) {
      return { invalid: { field, message: t('app.tickers.delivery.whole-number', 'Enter a whole number of seconds.') } };
    }
    patch[field] = Number(raw);
  }
  if (Object.keys(patch).length === 0) {
    return { invalid: { field: 'form', message: t('app.tickers.delivery.nothing-changed', 'Change a value to save.') } };
  }
  return { patch };
}

/**
 * Codes whose sentence is the server's own, written for people and raised
 * before anything is stored. Anything else (including DELIVERY_STANDBY_UNAVAILABLE,
 * which this slice never provokes) gets the fixed uncertainty line.
 */
const DELIVERY_REFUSAL_CODES = new Set([
  'DELIVERY_SETTINGS_OUT_OF_RANGE',
  'DELIVERY_SETTINGS_CONFLICT',
  'TICKER_SETTINGS_OUT_OF_RANGE',
  'TICKER_SETTINGS_CONFLICT',
  'BAD_USER_INPUT',
  'APP_NOT_FOUND',
]);
const MANAGER_SENTENCE = 'Only whoever manages this App can change its settings.';

export function classifyDeliveryError(e: unknown): WriteRefusal {
  if (!e || typeof e !== 'object' || !('response' in e)) return { kind: 'uncertain' };
  const first = (e as { response?: { errors?: { message?: unknown; extensions?: { code?: unknown } }[] } }).response?.errors?.[0];
  const code = typeof first?.extensions?.code === 'string' ? first.extensions.code : null;
  const message = typeof first?.message === 'string' ? first.message : null;
  if (!code || !message) return { kind: 'uncertain' };
  if (DELIVERY_REFUSAL_CODES.has(code)) return { kind: 'refused', code, message };
  if (code === 'FORBIDDEN' && (message === MANAGER_SENTENCE || message === IMPERSONATION_SENTENCE)) return { kind: 'refused', code, message };
  return { kind: 'uncertain' };
}
