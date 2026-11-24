import type { Cookies } from '@sveltejs/kit';
import type { GraphQLClient } from 'graphql-request';
import { loadChangeRequest, WITHDRAW_CHANGE_REQUEST_MUTATION } from '$lib/server/secrets';
import { secretWrite } from '$lib/server/secret-writes';
import { addTracked, parseTracked, READ_FAILURE_LIMIT, removeTracked, serializeTracked, TRACKED_COOKIE, type Tracked } from '$lib/secrets/tracked';
import { t } from '$lib/i18n/t';
import { ceremonyOrigin } from '$lib/ceremony-origin';
import { isTerminalState, rebuildCeremonyUrl } from '$lib/secrets/staged';

/** portal#2380 — the viewer's own change requests, re-read on every visit (no polling loop). */
export interface PendingRow {
  requestId: string;
  /** The secret the request is for; null while a staged create has none. */
  secretId: string | null;
  /** The name a staged create asked for; null for every other request. */
  createName: string | null;
  /**
   * The signing link, rebuilt from the configured origin (portal#2417: the cookie carries no URL).
   * Null when the origin is unconfigured: the row shows, with no link, never a guess.
   */
  ceremonyUrl: string | null;
  state: string;
  operation: string;
  expiresAt: string;
}

const OPTS = { path: '/app/apps', httpOnly: true, sameSite: 'lax' as const, maxAge: 7200 };

export const readTracked = (cookies: Cookies): Tracked[] => parseTracked(cookies.get(TRACKED_COOKIE));
export const writeTracked = (cookies: Cookies, list: Tracked[]) => {
  if (list.length === 0) cookies.delete(TRACKED_COOKIE, { path: OPTS.path });
  else cookies.set(TRACKED_COOKIE, serializeTracked(list), OPTS);
};
export const trackRequest = (cookies: Cookies, t: Tracked) => writeTracked(cookies, addTracked(readTracked(cookies), t));

/**
 * Re-read the requests `match` selects. A request the server no longer shows the viewer (null)
 * is dropped; one that has ended (a known terminal state) is shown this once, then dropped; an
 * open one, or one in a state this code does not know, stays, and a failed read keeps it for the
 * next visit, up to READ_FAILURE_LIMIT failed loads in a row (portal#2578): the last of them is
 * still counted, then the request is dropped so a read that keeps failing is not retried forever.
 */
export async function loadPending(
  client: Pick<GraphQLClient, 'request'>,
  cookies: Cookies,
  match: (t: Tracked) => boolean,
  /** An impersonated visit reads as someone else, so the server answers null for the admin's own requests: never write the cookie then. */
  readOnly = false,
): Promise<{ rows: PendingRow[]; unchecked: number }> {
  const all = readTracked(cookies);
  const mine = all.filter(match);
  const rows: PendingRow[] = [];
  // portal#2436 item 6: reads that failed (not "unread": a request that read fine and was shown is not in this count).
  // Kept in the cookie and counted, so the page can say so.
  let unchecked = 0;
  let kept = all;
  // portal#2417: the link comes from the configured origin, never from cookie content.
  const origin = ceremonyOrigin();
  // One round trip per tracked request, made together; rows keep the cookie's order.
  const reads = await Promise.all(mine.map((tr) => loadChangeRequest(client, tr.requestId)));
  for (const [i, tr] of mine.entries()) {
    const r = reads[i];
    if (r === 'failed') {
      unchecked++;
      const misses = (tr.misses ?? 0) + 1;
      kept = misses >= READ_FAILURE_LIMIT ? removeTracked(kept, tr.requestId) : kept.map((k) => (k.requestId === tr.requestId ? { ...k, misses } : k));
      continue;
    }
    if (r === null) { if (!readOnly) kept = removeTracked(kept, tr.requestId); continue; }
    // A read that worked ends the run of failures.
    if (tr.misses) kept = kept.map((k) => (k.requestId === tr.requestId ? { ...k, misses: undefined } : k));
    // The server stages a protected create as a STORE; the tracked create says which it was.
    const operation = r.operation.toUpperCase() === 'STORE' && tr.create ? 'CREATE' : r.operation;
    rows.push({ requestId: r.id, secretId: tr.secretId ?? null, createName: tr.create?.name ?? null, ceremonyUrl: rebuildCeremonyUrl(r.id, origin), state: r.state, operation, expiresAt: r.expiresAt });
    if (!readOnly && isTerminalState(r.state)) kept = removeTracked(kept, tr.requestId);
  }
  if (!readOnly && JSON.stringify(kept) !== JSON.stringify(all)) writeTracked(cookies, kept);
  return { rows, unchecked };
}

/** The withdraw action both pages share: sends once, and forgets the request only when it is gone. */
export async function withdrawRequest(client: Pick<GraphQLClient, 'request'>, cookies: Cookies, requestId: string) {
  const r = await secretWrite<{ withdrawSecretChangeRequest: boolean }>(client, WITHDRAW_CHANGE_REQUEST_MUTATION, { id: requestId });
  if (r.kind !== 'ok') return r;
  // The server answers false when nothing was withdrawn (the request had already ended): not a success.
  if (r.data.withdrawSecretChangeRequest !== true) {
    return { kind: 'refused' as const, message: t('secrets.withdraw.nothing', 'Nothing was withdrawn: this request has already ended.') };
  }
  writeTracked(cookies, removeTracked(readTracked(cookies), requestId));
  return r;
}
