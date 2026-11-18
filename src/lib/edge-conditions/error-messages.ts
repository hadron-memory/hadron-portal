import { extractGqlError, extractGqlErrorCode, extractGqlErrorExtensions } from '$lib/gql-error';
import { entryConditionScopeMessage } from '$lib/flow/conversation-entry-condition-form';
/**
 * Extracts a plain-language error message from a server response when an
 * edge-condition mutation fails. The hadron-server emits structured
 * errors with `extensions.messageId` (the i18n string id) and a
 * pre-resolved English text on `message`. The portal pipes both through
 * the i18n stub so a future loader can swap in localized copy without
 * call-site changes.
 */

import { t } from '$lib/i18n/t.js';

export function userFacingErrorMessage(err: unknown, fallback: string): string {
  // graphql-request throws ClientError; the response has .errors[].
  const anyErr = err as { response?: { errors?: Array<{ message?: string; extensions?: Record<string, unknown> }> } } | undefined;
  const errors = anyErr?.response?.errors;
  if (errors && errors.length > 0) {
    const first = errors[0];
    const ext = first.extensions as { messageId?: string } | undefined;
    if (extractGqlErrorCode(err) === 'EDGE_CONDITION_FAILED' && typeof first.message === 'string') {
      if (ext?.messageId) return t(ext.messageId, first.message);
      return first.message;
    }
  }
  return extractGqlError(err, fallback);
}

// S6's INVALID_ENTRY_CONDITION: `extensions.reason` plus `detail`, and no
// `messageId`. The reasons are the closed set the merged server throws; any
// other reason (or none) gets the caller's fallback, and the raw server message
// is never shown.
const INVALID_START_CONDITION_REASONS: readonly string[] = [
  'INVALID_JSON',
  'INVALID_JSONLOGIC',
  'DISALLOWED_OPERATOR',
  'UNKNOWN_SCOPE',
  'RESERVED_NAME',
  'AST_TOO_LARGE',
  'AST_TOO_DEEP',
];

export function entryConditionErrorMessage(err: unknown, fallback: string): string {
  if (extractGqlErrorCode(err) !== 'INVALID_ENTRY_CONDITION') return userFacingErrorMessage(err, fallback);
  const reason = extractGqlErrorExtensions(err)?.reason;
  if (reason === 'SCOPE_NOT_AVAILABLE_AT_START') return entryConditionScopeMessage();
  if (typeof reason === 'string' && INVALID_START_CONDITION_REASONS.includes(reason)) {
    return t('conversation.infoPanel.start.invalid', "This start condition isn't valid. Check it and try again.");
  }
  return fallback;
}
