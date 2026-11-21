import { env as publicEnv } from '$env/dynamic/public';

/**
 * portal#2417 — where a person may be sent to complete a server-hosted ceremony.
 *
 * The server mints every ceremony link from its own public origin and the portal only
 * hands the link over (hrn:node:hadronmemory.com:specs:cor:dmo:130:08,
 * hrn:node:hadronmemory.com:specs:cor:sec:070:02). The link is attacker-reachable twice:
 * a tracking cookie the browser can edit, and a redirect that follows the server's answer
 * verbatim. A link counts only when it is on the server's public origin, which the portal
 * learns from its own configuration (`PUBLIC_SERVER_URL`), the same origin the CSP
 * `form-action` allowance for the ceremony redirect already names.
 *
 * Unset or unusable means NO origin, so no link and no redirect: never a guess, and never
 * `LOCAL_SERVER_URL` (the internal address is not the public one) and never the
 * `localhost` default `publicServerBaseUrl()` applies to browser-side hand-overs
 * (hrn:node:hadronmemory.com:specs:cor:api:230:01, a link to the wrong host is worse than none).
 */
export function parseCeremonyOrigin(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The configured origin, read per call so a test or a runtime change is seen. */
export const ceremonyOrigin = (): string | null => parseCeremonyOrigin(publicEnv.PUBLIC_SERVER_URL);

/**
 * `v` when it is an http(s) URL on exactly `origin` (and under `pathPrefix` when given),
 * else null. A null origin pins nothing, so it yields null for every input.
 */
export function pinCeremonyUrl(v: unknown, origin: string | null, pathPrefix = ''): string | null {
  if (!origin || typeof v !== 'string' || v.length > 2048) return null;
  try {
    const u = new URL(v);
    if (u.username || u.password) return null;
    if (u.origin !== origin) return null;
    return u.pathname.startsWith(pathPrefix) ? v : null;
  } catch {
    return null;
  }
}
