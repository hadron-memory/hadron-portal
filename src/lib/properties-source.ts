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

export type PropertiesSourceError = 'empty' | 'too-large' | 'invalid-json' | 'not-object' | 'unsafe-number' | 'too-deep';

/**
 * Deepest nesting the Source view accepts. Far past any real properties bag
 * (the deepest in the corpus is `exports.<host>.<field>`, three), and far
 * short of the depth at which the recursive canonicalization behind the stale
 * check would overflow the stack (@codex on #893: a few thousand levels fit
 * under the size cap and crashed the page).
 */
export const PROPERTIES_MAX_DEPTH = 64;

/** The byte length the request will actually carry. */
export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * A number literal's exact decimal VALUE as a comparable key: sign, significant
 * digits, exponent — so `1.0`, `1e0` and `1` compare equal while
 * `1.2345678901234567` and `1.234567890123456789` do not. Zero is unsigned.
 * Null for anything that is not a plain decimal (`Infinity`, `NaN`).
 */
function decimalKey(literal: string): string | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(literal);
  if (!m) return null;
  const [, sign, int, frac = '', exp = '0'] = m;
  let digits = (int + frac).replace(/^0+/, '');
  if (digits === '') return '0';
  let e = Number(exp) - frac.length;
  const trimmed = digits.replace(/0+$/, '');
  e += digits.length - trimmed.length;
  digits = trimmed;
  return `${sign}${digits}e${e}`;
}

const NUMBER_AT = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/**
 * One pass over valid JSON text, outside strings: the first number literal
 * that JSON cannot carry back EXACTLY (or null), and the deepest nesting.
 *
 * Numbers: a JSON number becomes a 64-bit float, so `1e400` turns into
 * Infinity (sent as `null`), an integer past 2^53 is rounded, and so is a
 * fraction with more precision than a double holds (`1.234567890123456789`) or
 * one that underflows (`1e-400`). In every case the editor would call the text
 * valid and save a different bag (@codex on #893, twice). Checked per TOKEN: a
 * parsed value has already lost what it lost, so only the literal can say
 * whether its double represents it exactly. Values are compared, not spellings
 * — `1.0`, `1e2` and `0.10` pass.
 *
 * Depth: counted here, iteratively, so a pathological nesting is refused
 * BEFORE anything recursive touches it.
 */
export function scanSource(raw: string): { inexact: string | null; depth: number } {
  let inexact: string | null = null;
  let depth = 0;
  let max = 0;
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c === '"') {
      i++;
      while (i < raw.length && raw[i] !== '"') i += raw[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (c === '{' || c === '[') {
      depth++;
      if (depth > max) max = depth;
    } else if (c === '}' || c === ']') {
      depth--;
    } else if (c === '-' || (c >= '0' && c <= '9')) {
      // Sticky: matches AT i without copying the rest of the text — a slice
      // per number is quadratic on a 256 KB bag of numbers.
      NUMBER_AT.lastIndex = i;
      const m = NUMBER_AT.exec(raw);
      if (m) {
        const literal = m[0];
        if (inexact === null && decimalKey(literal) !== decimalKey(String(Number(literal)))) inexact = literal;
        i += literal.length;
        continue;
      }
    }
    i++;
  }
  return { inexact, depth: max };
}

/** The first number literal JSON cannot carry back exactly, or null. */
export function inexactNumber(raw: string): string | null {
  return scanSource(raw).inexact;
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
  // Scanned BEFORE parsing: the scan is iterative and safe on any text, and a
  // pathological depth must be refused before anything recursive sees it.
  const scan = scanSource(text);
  if (scan.depth > PROPERTIES_MAX_DEPTH) return { ok: false, code: 'too-deep' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, code: 'invalid-json', detail: e instanceof Error ? e.message : undefined };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: 'not-object' };
  }
  if (scan.inexact) return { ok: false, code: 'unsafe-number', detail: scan.inexact };
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
