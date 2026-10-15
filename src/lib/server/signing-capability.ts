import { serverBaseUrl } from '$lib/server/api';

/**
 * portal#1022 gate — does this deployment offer node signing?
 *
 * `ServerInfo.signing` is TRUE-ONLY (hadron-server#1918): while signing is off,
 * `deploymentSchema()` removes the field — and `Node.signatureStatus` with it —
 * so SELECTING either fails GraphQL validation. The answer comes from
 * `GET /capabilities` instead (hadron-server#1925, Holger 2026-10-14;
 * `cor:api:020:01`): `{"capabilities":[...]}`, the ON switches as MCP's token
 * words, readable before sign-in. An off switch is left out, never `false`.
 * This replaced #1097's stopgap, which parsed the authenticated SDL route
 * (portal#1098).
 *
 * The answer is a deployment fact, identical for every caller, so it is held
 * per portal process. How long comes from the endpoint itself: its
 * `Cache-Control: max-age` is the freshness window, and its strong ETag
 * revalidates after that (a 304 renews the window without a body). The switches
 * change only with a server restart, which is what a revalidation sees.
 *
 * Fail closed: a refusal (including the endpoint's per-IP 429), a network
 * failure, a hung request past the deadline, or a body of the wrong shape all
 * read as EVERY switch off. Off renders nothing, which is what a failed
 * signature read rendered before this gate. Failures are held for a retry
 * window, so a broken endpoint is not hit per view.
 */

/** A hung request gives up here, so one shared request can't stall every node view (Anne's P3, #1097). */
export const CAPABILITIES_DEADLINE_MS = 5_000;
/** How long a failure is held before the next attempt. Failures carry no cache headers of their own. */
export const CAPABILITIES_FAILURE_RETRY_MS = 60_000;

type Held = { value: ReadonlySet<string>; etag: string | null; freshUntil: number };

const OFF: ReadonlySet<string> = new Set();

let held: Held | null = null;
let inflight: Promise<ReadonlySet<string>> | null = null;

/** The deployment's ON switch tokens (e.g. `node-signing`, `passkey-registration`). Never throws. */
export function deploymentCapabilities(): Promise<ReadonlySet<string>> {
  if (held && Date.now() < held.freshUntil) return Promise.resolve(held.value);
  inflight ??= fetchCapabilities(held).then((next) => {
    held = next;
    inflight = null;
    return next.value;
  });
  return inflight;
}

/**
 * Whether to read node signatures at all. Without a token there is no session
 * to read them with, so this answers off without asking.
 */
export async function deploymentOffersSigning(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  return (await deploymentCapabilities()).has('node-signing');
}

async function fetchCapabilities(previous: Held | null): Promise<Held> {
  const failed = (why: string, e?: unknown): Held => {
    if (e === undefined) console.warn(`[capabilities] ${why}; treating every switch as off`);
    else console.warn(`[capabilities] ${why}; treating every switch as off:`, e);
    return { value: OFF, etag: null, freshUntil: Date.now() + CAPABILITIES_FAILURE_RETRY_MS };
  };

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), CAPABILITIES_DEADLINE_MS);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (previous?.etag) headers['If-None-Match'] = previous.etag;
    const res = await fetch(`${serverBaseUrl()}/capabilities`, { headers, signal: controller.signal });

    if (res.status === 304) {
      if (!previous?.etag) return failed('a 304 with nothing held to reuse');
      return { value: previous.value, etag: res.headers.get('ETag') ?? previous.etag, freshUntil: freshUntil(res) };
    }
    if (!res.ok) return failed(`GET /capabilities answered ${res.status}`);

    const body: unknown = await res.json().catch(() => undefined);
    const list = (body as { capabilities?: unknown } | undefined)?.capabilities;
    if (!Array.isArray(list) || !list.every((c) => typeof c === 'string')) {
      return failed('GET /capabilities answered a body of the wrong shape');
    }
    return { value: new Set(list), etag: res.headers.get('ETag'), freshUntil: freshUntil(res) };
  } catch (e) {
    return failed(controller.signal.aborted ? `GET /capabilities passed its ${CAPABILITIES_DEADLINE_MS}ms deadline` : 'GET /capabilities failed', e);
  } finally {
    clearTimeout(deadline);
  }
}

/** `max-age` from the response's Cache-Control; without one the answer is not reused (it still revalidates by ETag). */
function freshUntil(res: Response): number {
  const m = /(?:^|,)\s*max-age\s*=\s*(\d+)/i.exec(res.headers.get('Cache-Control') ?? '');
  return Date.now() + (m ? Number(m[1]) * 1000 : 0);
}
