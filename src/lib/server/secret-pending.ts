import type { Cookies } from '@sveltejs/kit';
import type { GraphQLClient } from 'graphql-request';
import { loadChangeRequest, WITHDRAW_CHANGE_REQUEST_MUTATION } from '$lib/server/secrets';
import { secretWrite } from '$lib/server/secret-writes';
import { addTracked, parseTracked, removeTracked, serializeTracked, TRACKED_COOKIE, type Tracked } from '$lib/secrets/tracked';
import { t } from '$lib/i18n/t';
import { ceremonyOrigin } from '$lib/ceremony-origin';
import { isTerminalState } from '$lib/secrets/staged';

/** portal#2380 — the viewer's own change requests, re-read on every visit (no polling loop). */
export interface PendingRow {
  requestId: string;
  /** The secret the request is for; null while a staged create has none. */
  secretId: string | null;
  /** The name a staged create asked for; null for every other request. */
  createName: string | null;
  ceremonyUrl: string;
  state: string;
  operation: string;
  expiresAt: string;
}

const OPTS = { path: '/app/apps', httpOnly: true, sameSite: 'lax' as const, maxAge: 7200 };

export const readTracked = (cookies: Cookies): Tracked[] => parseTracked(cookies.get(TRACKED_COOKIE), ceremonyOrigin());
export const writeTracked = (cookies: Cookies, list: Tracked[]) => {
  if (list.length === 0) cookies.delete(TRACKED_COOKIE, { path: OPTS.path });
  else cookies.set(TRACKED_COOKIE, serializeTracked(list), OPTS);
};
export const trackRequest = (cookies: Cookies, t: Tracked) => writeTracked(cookies, addTracked(readTracked(cookies), t));

/**
 * Re-read the requests `match` selects. A request the server no longer shows the viewer (null)
 * is dropped; one that has ended (a known terminal state) is shown this once, then dropped; an
 * open one, or one in a state this code does not know, stays, and a failed read keeps it for the
 * next visit.
 */
export async function loadPending(
  client: Pick<GraphQLClient, 'request'>,
  cookies: Cookies,
  match: (t: Tracked) => boolean,
  /** An impersonated visit reads as someone else, so the server answers null for the admin's own requests: never write the cookie then. */
  readOnly = false,
): Promise<{ rows: PendingRow[]; unread: number }> {
  const all = readTracked(cookies);
  const mine = all.filter(match);
  const rows: PendingRow[] = [];
  // portal#2436 item 6: reads that failed. Kept in the cookie and counted, so the page can say so.
  let unread = 0;
  let kept = all;
  // One round trip per tracked request, made together; rows keep the cookie's order.
  const reads = await Promise.all(mine.map((tr) => loadChangeRequest(client, tr.requestId)));
  for (const [i, tr] of mine.entries()) {
    const r = reads[i];
    if (r === 'failed') { unread++; continue; }
    if (r === null) { if (!readOnly) kept = removeTracked(kept, tr.requestId); continue; }
    // The server stages a protected create as a STORE; the tracked create says which it was.
    const operation = r.operation.toUpperCase() === 'STORE' && tr.create ? 'CREATE' : r.operation;
    rows.push({ requestId: r.id, secretId: tr.secretId ?? null, createName: tr.create?.name ?? null, ceremonyUrl: tr.ceremonyUrl, state: r.state, operation, expiresAt: r.expiresAt });
    if (!readOnly && isTerminalState(r.state)) kept = removeTracked(kept, tr.requestId);
  }
  if (!readOnly && kept.length !== all.length) writeTracked(cookies, kept);
  return { rows, unread };
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
