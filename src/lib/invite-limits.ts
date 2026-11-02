import { formatPortalDate } from '$lib/format-portal-date';

// V49 (hrn:node:hadronmemory.com:specs:cor:dmo:040:05): the server refuses an explicit expiresInDays outside
// 1-10 and maxActivations outside 2-1000. Both invite forms send these values
// explicitly: valid on today's server and after V49, so there is no window in
// which an invite fails (hadron-portal#1592, hadron-server#2984).
export const INVITE_EXPIRES_IN_DAYS = 10;
export const INVITE_MAX_ACTIVATIONS = 2;

/**
 * Success-copy sentence built from what the server returned, never from what
 * the portal asked for. Null/absent fields read as "no limit" rather than
 * borrowing a hard-coded promise.
 */
export function describeInviteLimits(result: {
  expiresAt?: string | null;
  maxActivations?: number | null;
}): string {
  const expiry = result.expiresAt && formatPortalDate(result.expiresAt) !== '—'
    ? `Expires ${formatPortalDate(result.expiresAt)}`
    : 'Does not expire';
  const n = result.maxActivations;
  const uses = typeof n === 'number'
    ? `can be used ${n} ${n === 1 ? 'time' : 'times'}`
    : 'has no use limit';
  return `${expiry}; ${uses}.`;
}
