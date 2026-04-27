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
    if (typeof first.message === 'string') {
      if (ext?.messageId) return t(ext.messageId, first.message);
      return first.message;
    }
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
