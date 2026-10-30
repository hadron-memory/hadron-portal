import type { WriteRefusal } from '$lib/agent-tasks/actions';
import { t } from '$lib/i18n/t';
import { IMPERSONATION_SENTENCE } from '$lib/server/agent-task-writes';

/**
 * portal#1151 (Tickers S7b) — the ticker write mutations and what their
 * refusals tell the reader. Kept apart from `tickers.ts`, which holds only the
 * Tickers views' reads (portal#1099).
 *
 * Who may do what is the server's call and is never guessed here
 * (hrn:node:hadronmemory.com:specs:cor:agt:080:18): create is open to any App
 * participant up to the live-ticker cap; edit, disable and delete are the
 * ticker's owner, its owning worker's holder and whoever manages the App. The
 * portal offers the controls to every participant and renders the refusal.
 */

export const CREATE_TICKER_MUTATION = /* GraphQL */ `
  mutation CreateTicker($appRef: String!, $input: TickerInput!) {
    createTicker(appRef: $appRef, input: $input) { id name }
  }
`;

export const UPDATE_TICKER_MUTATION = /* GraphQL */ `
  mutation UpdateTicker($ref: String!, $input: TickerPatch!) {
    updateTicker(ref: $ref, input: $input) { id }
  }
`;

export const DELETE_TICKER_MUTATION = /* GraphQL */ `
  mutation DeleteTicker($ref: String!) {
    deleteTicker(ref: $ref)
  }
`;

export type TickerWriteAction = 'create' | 'update' | 'delete';

/** Codes whose sentence is the server's own, raised before anything is stored. */
const SERVER_SENTENCE_CODES = new Set([
  'BAD_USER_INPUT',
  'TICKER_NOT_FOUND',
  'TICKER_NAME_TAKEN',
  'TICKER_CADENCE_OUT_OF_RANGE',
  'TICKER_LIMIT_REACHED',
  'TICKER_QUIET_HOURS_INVALID',
  'APP_NOT_FOUND',
  'APP_UNINSTALLED',
]);

/**
 * The consent refusal comes from adding either widening reason (and from a
 * faster cadence), so its copy is the portal's and names neither alone
 * (Vera's FIT on #1151). Removing a reason is never checked.
 */
const consentSentence = () =>
  t(
    'app.tickers.write.consent',
    'This change could wake a subscriber more often, or on ticks that would not have woken it, and you are not allowed to subscribe one of its subscribers on those terms. Adding Every tick or Live check is checked this way. Whoever manages the App, or the worker’s holder, can make it.',
  );

function forbiddenSentence(action: TickerWriteAction): string {
  switch (action) {
    case 'create':
      return t('app.tickers.write.forbidden.create', 'You can’t create a ticker in this App.');
    case 'update':
      return t('app.tickers.write.forbidden.update', 'You can’t change this ticker. Its owner, the owning worker’s holder, or whoever manages the App can.');
    case 'delete':
      return t('app.tickers.write.forbidden.delete', 'You can’t delete this ticker. Its owner, the owning worker’s holder, or whoever manages the App can.');
  }
}

export function classifyTickerWriteError(e: unknown, action: TickerWriteAction): WriteRefusal {
  if (!e || typeof e !== 'object' || !('response' in e)) return { kind: 'uncertain' };
  const first = (e as { response?: { errors?: { message?: unknown; extensions?: { code?: unknown } }[] } }).response?.errors?.[0];
  const code = typeof first?.extensions?.code === 'string' ? first.extensions.code : null;
  const message = typeof first?.message === 'string' ? first.message : null;
  if (!code || !message) return { kind: 'uncertain' };
  if (SERVER_SENTENCE_CODES.has(code)) return { kind: 'refused', code, message };
  if (code === 'TICKER_CADENCE_NEEDS_CONSENT') return { kind: 'refused', code, message: consentSentence() };
  if (code === 'FORBIDDEN') {
    return { kind: 'refused', code, message: message === IMPERSONATION_SENTENCE ? message : forbiddenSentence(action) };
  }
  return { kind: 'uncertain' };
}
