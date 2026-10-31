import type { WriteRefusal } from '$lib/agent-tasks/actions';
import { t } from '$lib/i18n/t';
import { extractGqlErrorExtensions, internalErrorText } from '$lib/gql-error';
import { validRequestId } from '$lib/error-request-id';
import { tickerSubscribeWhoText } from '$lib/tickers/controls';
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

/**
 * portal#1497 (MCP cut R7a) — the activation and subscriber mutations, on the
 * operations the disabled MCP tools used (hadron-server#1747). The on/off
 * control echoes `{ id enabled }` so the page can prove the server applied the
 * DESIRED value; a subscribe/unsubscribe answers `SubscribeResult`, whose
 * `subscription.endedAt` says which of the two it was. `announcement` is
 * selected because a FAILED grant notice is shown (never retried): from the
 * portal it is null (a person carries no grant), so this is defence, not an
 * expectation.
 */
export const SET_TICKER_ENABLED_MUTATION = /* GraphQL */ `
  mutation SetTickerEnabled($ref: String!, $input: TickerPatch!) {
    updateTicker(ref: $ref, input: $input) { id enabled }
  }
`;

export const SUBSCRIBE_WORKER_MUTATION = /* GraphQL */ `
  mutation SubscribeWorker($tickerRef: String!, $workerRef: String!) {
    subscribeWorker(tickerRef: $tickerRef, workerRef: $workerRef) {
      announcement
      subscription { id endedAt }
    }
  }
`;

export const UNSUBSCRIBE_WORKER_MUTATION = /* GraphQL */ `
  mutation UnsubscribeWorker($tickerRef: String!, $workerRef: String!) {
    unsubscribeWorker(tickerRef: $tickerRef, workerRef: $workerRef) {
      announcement
      subscription { id endedAt }
    }
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

/*
 * portal#1497 — the ticker CONTROL actions (on/off, subscribe, unsubscribe).
 * Unlike the edit/delete family above, every sentence here is the PORTAL's
 * fixed copy: the acceptance pins an allowlist of codes with no server prose,
 * because a ticker/worker the viewer cannot even name (TICKER_NOT_FOUND,
 * WORKER_NOT_FOUND, APP_NOT_FOUND) must render as ONE sentence so the page is
 * never an existence oracle, and the subscription refusals carry rules the
 * portal restates in its own words (hrn:node:hadronmemory.com:specs:cor:agt:080:20 for who may; hrn:node:hadronmemory.com:specs:cor:agt:080:06 for what
 * turning off does not do).
 */
export type TickerControlAction = 'set-enabled' | 'subscribe' | 'unsubscribe';

/** The one sentence for a ticker or worker this viewer cannot act on: never three, so nothing is told apart. */
export const tickerNotAvailableText = () =>
  t('app.ticker.controls.not-available', 'This ticker or worker isn’t available to you. Reload the page.');

// hrn:node:hadronmemory.com:specs:cor:agt:080:20's sentence lives in $lib/tickers/controls (the page renders it
// beside the subscriber controls too); re-exported here so the classifier and
// the page share ONE copy (D4).
export { tickerSubscribeWhoText };

function controlForbiddenSentence(action: TickerControlAction): string {
  switch (action) {
    case 'set-enabled':
      // hrn:node:hadronmemory.com:specs:cor:agt:080:18 governs on/off; the page's `app.ticker.who` line states the same rule.
      return t(
        'app.ticker.controls.forbidden.set-enabled',
        'You can’t turn this ticker on or off. Its owner, the owning worker’s holder, or whoever manages the App can.',
      );
    case 'subscribe':
      return tickerSubscribeWhoText();
    case 'unsubscribe':
      return tickerSubscribeWhoText();
  }
}

export function classifyTickerControlError(e: unknown, action: TickerControlAction): WriteRefusal {
  if (!e || typeof e !== 'object' || !('response' in e)) return { kind: 'uncertain' };
  const first = (e as { response?: { errors?: { message?: unknown; extensions?: { code?: unknown } }[] } }).response?.errors?.[0];
  const code = typeof first?.extensions?.code === 'string' ? first.extensions.code : null;
  const message = typeof first?.message === 'string' ? first.message : null;
  if (!code || !message) return { kind: 'uncertain' };
  if (code === 'TICKER_NOT_FOUND' || code === 'WORKER_NOT_FOUND' || code === 'APP_NOT_FOUND') {
    return { kind: 'refused', code, message: tickerNotAvailableText() };
  }
  if (code === 'SUBSCRIBE_FORBIDDEN') {
    // The server stamps `held` on the extension: whether anyone holds the worker
    // at all. One portal sentence per value, and never the server's own prose.
    const held = extractGqlErrorExtensions(e)?.held === true;
    return {
      kind: 'refused',
      code,
      message: held
        ? t('app.ticker.controls.forbidden.held', 'Only this worker’s holder or whoever manages the App can subscribe or unsubscribe it.')
        : t('app.ticker.controls.forbidden.unheld', 'This worker is held by nobody. Only whoever manages the App can subscribe or unsubscribe it.'),
    };
  }
  if (code === 'SUBSCRIPTION_NOT_FOUND') {
    return { kind: 'refused', code, message: t('app.ticker.controls.no-longer-subscribed', 'No longer subscribed. The list is back at its first page.') };
  }
  if (code === 'WORKER_RETIRED') {
    return { kind: 'refused', code, message: t('app.ticker.controls.retired', 'A retired worker can’t be subscribed.') };
  }
  if (code === 'APP_UNINSTALLED') {
    return { kind: 'refused', code, message: t('app.ticker.controls.uninstalled', 'This App has been uninstalled, so nothing here can be changed.') };
  }
  if (code === 'FORBIDDEN') {
    return { kind: 'refused', code, message: message === IMPERSONATION_SENTENCE ? message : controlForbiddenSentence(action) };
  }
  if (code === 'INTERNAL_SERVER_ERROR') {
    // The stamped gate: the fixed internal line, plus its request id when the
    // envelope carries one. Never the payload's own text.
    const requestId = validRequestId(extractGqlErrorExtensions(e)?.requestId);
    return {
      kind: 'refused',
      code,
      message: requestId
        ? `${internalErrorText()} ${t('error.request-id', 'Request ID: {id}', { id: requestId })}`
        : internalErrorText(),
    };
  }
  return { kind: 'uncertain' };
}

/** The refusal the route-to-ticker App check answers with: the same one sentence, before any mutation is sent. */
export function tickerNotAvailableRefusal(): WriteRefusal {
  return { kind: 'refused', code: 'TICKER_NOT_FOUND', message: tickerNotAvailableText() };
}
