import { safeCeremonyUrl } from './staged';
/**
 * portal#2380 — the server has no "list my change requests" read, only
 * `secretChangeRequest(id)`. So the portal remembers the ids of requests the viewer opened,
 * in a short-lived httpOnly cookie, and re-reads each one on revisit (no polling loop).
 * The cookie holds ids and the server's ceremony link (a link alone reveals nothing, cor:sec:070:02): never a value. The server answers null to anyone
 * who is not the requester, so a copied cookie discloses nothing.
 */
export const TRACKED_COOKIE = 'hadron_secret_requests';
export const TRACKED_MAX = 10;
export interface Tracked { secretId: string; requestId: string; ceremonyUrl: string }

const ok = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 128;

export function parseTracked(raw: string | undefined): Tracked[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is Tracked => !!x && typeof x === 'object' && ok((x as Tracked).secretId) && ok((x as Tracked).requestId) && safeCeremonyUrl((x as Tracked).ceremonyUrl) !== null)
      .map((x) => ({ secretId: x.secretId, requestId: x.requestId, ceremonyUrl: x.ceremonyUrl }))
      .slice(-TRACKED_MAX);
  } catch {
    return [];
  }
}

export const addTracked = (list: Tracked[], add: Tracked): Tracked[] =>
  [...list.filter((x) => x.requestId !== add.requestId), add].slice(-TRACKED_MAX);

export const removeTracked = (list: Tracked[], requestId: string): Tracked[] =>
  list.filter((x) => x.requestId !== requestId);

export const serializeTracked = (list: Tracked[]): string => JSON.stringify(list.slice(-TRACKED_MAX));
