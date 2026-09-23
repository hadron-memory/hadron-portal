/**
 * #886 — the node page's Properties tab, Source view: `Node.properties` edited
 * as raw JSON, on EVERY node — typed collections included, where the typed
 * editor could only delete an undeclared key (`exports` among them), never
 * edit it.
 *
 * Pure, so the page and the action agree on one definition of "valid", and so
 * the stale-page check can be tested without a server.
 */

/** Same soft cap as the Data tab (256 KB): a pathological paste fails legibly. */
export const PROPERTIES_MAX = 262144;

export type PropertiesSourceError = 'empty' | 'too-large' | 'invalid-json' | 'not-object';

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
  if (raw.length > PROPERTIES_MAX) return { ok: false, code: 'too-large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, code: 'invalid-json', detail: e instanceof Error ? e.message : undefined };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: 'not-object' };
  }
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
