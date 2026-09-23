/**
 * #886 — the node page's Properties tab, Source view: `Node.properties` edited
 * as raw JSON, on EVERY node — typed collections included, where the typed
 * editor could only delete an undeclared key (`exports` among them), never
 * edit it.
 *
 * Pure, so the page and the action agree on one definition of "valid", and so
 * the stale-page check can be tested without a server.
 */

/**
 * Same soft cap as the Data tab — 256 KB, counted in UTF-8 BYTES (@codex on
 * #893): the adapter's body limit is bytes, and 256K characters of non-Latin
 * text are up to three times that on the wire.
 */
export const PROPERTIES_MAX = 262144;

export type PropertiesSourceError = 'empty' | 'too-large' | 'invalid-json' | 'not-object' | 'unsafe-number';

/** The byte length the request will actually carry. */
export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * The first number that JSON cannot carry back unchanged, as a path — or null.
 *
 * `JSON.parse('{"a": 1e400}')` yields `Infinity`, which `JSON.stringify` then
 * writes as `null`; an integer past 2^53 is silently rounded. Either way the
 * editor would save a different bag than the one the user typed and read as
 * "valid" (@codex on #893). Refused with the path, so the user can quote it as
 * a string instead.
 */
export function unsafeNumberPath(value: unknown, path = ''): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      return path || '(root)';
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = unsafeNumberPath(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const hit = unsafeNumberPath(v, path ? `${path}.${k}` : k);
      if (hit) return hit;
    }
  }
  return null;
}

export type PropertiesParse =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; code: PropertiesSourceError; detail?: string };

/**
 * Parse the Source text. `properties` is a JSON OBJECT on the server — an
 * array, a scalar or a bare `null` is refused here rather than handed to the
 * API. Empty text is refused too: `{}` is how a user says "no properties", and
 * making that explicit keeps an accidental select-all-delete from wiping every
 * key on Save.
 */
export function parsePropertiesSource(raw: string): PropertiesParse {
  const text = raw.trim();
  if (text === '') return { ok: false, code: 'empty' };
  if (utf8Length(raw) > PROPERTIES_MAX) return { ok: false, code: 'too-large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, code: 'invalid-json', detail: e instanceof Error ? e.message : undefined };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: 'not-object' };
  }
  const unsafe = unsafeNumberPath(parsed);
  if (unsafe) return { ok: false, code: 'unsafe-number', detail: unsafe };
  return { ok: true, value: parsed as Record<string, unknown> };
}

/**
 * JSON with object keys sorted at every depth, so two bags that differ only in
 * key ORDER compare equal. JSONB does not preserve key order, so the stored
 * bag's order is not something the user chose — comparing raw strings would
 * report a change nobody made.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/**
 * Do two properties values say the same thing? `null`/absent and `{}` are
 * treated as the same — "no properties" — because the server stores either for
 * an empty bag and neither is a change a reader could see.
 */
export function sameProperties(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v == null ? {} : v);
  return canonicalJson(norm(a)) === canonicalJson(norm(b));
}

/**
 * A SHA-256 fingerprint of a properties bag — what the Source form posts as
 * its baseline instead of a second full copy (@codex on #893: two copies of a
 * bag at the cap overran the 512 KB body limit before the action could run).
 *
 * Canonical (sorted keys) and with `null` ≡ `{}`, so it agrees with
 * `sameProperties`. Web Crypto, which both the browser (secure contexts — the
 * portal is served over HTTPS, and localhost counts) and Node ≥ 19 provide as
 * `globalThis.crypto`, so the page and the action run the SAME code.
 */
export async function propertiesFingerprint(value: unknown): Promise<string> {
  const canonical = canonicalJson(value == null ? {} : value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A well-formed fingerprint: 64 lowercase hex digits. */
export function isFingerprint(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}
