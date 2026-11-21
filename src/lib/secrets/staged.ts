import { extractGqlErrorCode, extractGqlErrorExtensions } from '$lib/gql-error';
import { t } from '$lib/i18n/t';
import { pinCeremonyUrl } from '$lib/ceremony-origin';

/**
 * portal#2380 — a protected App secret's change is STAGED, not applied
 * (hrn:node:hadronmemory.com:specs:cor:sec:070:02). The server answers the call
 * `SECRET_PROTECTED_NEEDS_PASSKEY`; with `requestId` and `ceremonyUrl` when a request
 * was opened, with neither when nothing was staged (a refused caller), so the code alone
 * never means a request is open.
 *
 * The portal hands the person the link and NEVER completes the ceremony itself.
 */
export const NEEDS_PASSKEY = 'SECRET_PROTECTED_NEEDS_PASSKEY';

export type StagedRefusal =
  | { kind: 'staged'; requestId: string; ceremonyUrl: string }
  | { kind: 'plain-protected' };

/**
 * The server's page: on the server's public origin (portal#2417) and under /secret-changes/.
 * `origin` is required so a caller cannot forget it; null (unconfigured) never makes a link.
 */
export function safeCeremonyUrl(v: unknown, origin: string | null): string | null {
  return pinCeremonyUrl(v, origin, '/secret-changes/');
}

export function readStagedChange(e: unknown, origin: string | null): StagedRefusal | null {
  if (extractGqlErrorCode(e) !== NEEDS_PASSKEY) return null;
  const ext = extractGqlErrorExtensions(e);
  const id = ext?.requestId;
  const url = safeCeremonyUrl(ext?.ceremonyUrl, origin);
  if (typeof id === 'string' && id.length > 0 && id.length <= 128 && url) {
    return { kind: 'staged', requestId: id, ceremonyUrl: url };
  }
  return { kind: 'plain-protected' };
}

export const isOpenState = (s: string) => s.toLowerCase() === 'open';

/**
 * The states a request ends in (hrn:node:hadronmemory.com:specs:cor:sec:070:02): completed, declined,
 * expired, withdrawn; `stale` is how a request that lost a race to a change ends. Any other state is
 * unknown, never assumed ended: the notice keeps showing it rather than dropping a request unseen.
 */
const TERMINAL_STATES = new Set(['completed', 'declined', 'expired', 'withdrawn', 'stale']);
export const isTerminalState = (s: string) => TERMINAL_STATES.has(s.toLowerCase());

export function requestStateText(state: string): string {
  switch (state.toLowerCase()) {
    case 'open': return t('secrets.request.state.open', 'Waiting for your passkey signature');
    case 'completed': return t('secrets.request.state.completed', 'Signed and applied');
    case 'expired': return t('secrets.request.state.expired', 'Expired before it was signed');
    case 'withdrawn': return t('secrets.request.state.withdrawn', 'Withdrawn');
    case 'declined': return t('secrets.request.state.declined', 'Declined');
    case 'stale': return t('secrets.request.state.stale', 'The secret changed first, so this request can no longer be applied');
    default: return state;
  }
}
