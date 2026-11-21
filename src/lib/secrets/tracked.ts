import { safeCeremonyUrl } from './staged';
/**
 * portal#2380 — the server has no "list my change requests" read, only
 * `secretChangeRequest(id)`. So the portal remembers the ids of requests the viewer opened,
 * in a short-lived httpOnly cookie, and re-reads each one on revisit (no polling loop).
 * The cookie holds ids and the server's ceremony link (a link alone reveals nothing, hrn:node:hadronmemory.com:specs:cor:sec:070:02): never a value. The server answers null to anyone
 * who is not the requester, so a copied cookie discloses nothing.
 */
export const TRACKED_COOKIE = 'hadron_secret_requests';
export const TRACKED_MAX = 10;
/**
 * What a request is about: an existing secret (`secretId`), or a secret that does not exist yet
 * because its create is staged (`create`: the App's id and the name asked for). Exactly one is set.
 * A request cookie written before this shape keyed creates by a `create:<app>:<name>` string in
 * `secretId`; that is no longer read, so such an entry is dropped (the cookie lives two hours).
 */
export type Tracked = { requestId: string; ceremonyUrl: string } & (
  | { secretId: string; create?: undefined }
  | { create: { appId: string; name: string }; secretId?: undefined }
);

const ok = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 128;

export function parseTracked(raw: string | undefined, origin: string | null): Tracked[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: Tracked[] = [];
    for (const x of v) {
      if (!x || typeof x !== 'object') continue;
      const { requestId, ceremonyUrl, secretId, create } = x as Record<string, unknown>;
      if (!ok(requestId) || safeCeremonyUrl(ceremonyUrl, origin) === null) continue;
      const base = { requestId, ceremonyUrl: ceremonyUrl as string };
      if (create !== undefined) {
        const c = create as Record<string, unknown> | null;
        if (secretId === undefined && c && typeof c === 'object' && ok(c.appId) && ok(c.name)) out.push({ ...base, create: { appId: c.appId, name: c.name } });
      } else if (ok(secretId) && !secretId.startsWith('create:')) {
        out.push({ ...base, secretId });
      }
    }
    return out.slice(-TRACKED_MAX);
  } catch {
    return [];
  }
}

export const addTracked = (list: Tracked[], add: Tracked): Tracked[] =>
  [...list.filter((x) => x.requestId !== add.requestId), add].slice(-TRACKED_MAX);

export const removeTracked = (list: Tracked[], requestId: string): Tracked[] =>
  list.filter((x) => x.requestId !== requestId);

export const serializeTracked = (list: Tracked[]): string => JSON.stringify(list.slice(-TRACKED_MAX));
