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

export type PropertiesSourceError =
  | 'empty'
  | 'too-large'
  | 'invalid-json'
  | 'not-object'
  | 'unsafe-number'
  | 'too-deep'
  | 'duplicate-key'
  | 'top-level-null';

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
export function scanSource(raw: string): { inexact: string | null; depth: number; duplicate: string | null } {
  let inexact: string | null = null;
  let duplicate: string | null = null;
  let max = 0;
  // One frame per open container. An object frame carries the keys seen so
  // far and whether the next string is a KEY (after `{` or `,`) or a value.
  const frames: Array<{ keys: Set<string>; expectKey: boolean } | null> = [];
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c === '"') {
      const start = i;
      i++;
      while (i < raw.length && raw[i] !== '"') i += raw[i] === '\\' ? 2 : 1;
      i++;
      // Duplicate keys (@codex on #893): JSON.parse keeps the LAST, silently,
      // so `{"exports":…,"exports":…}` would save one of two things the user
      // typed. Keys are compared DECODED — "a" and "\u0061" are one key.
      const top = frames[frames.length - 1];
      if (top && top.expectKey && duplicate === null) {
        let key: string;
        try {
          key = JSON.parse(raw.slice(start, i)) as string;
        } catch {
          key = raw.slice(start, i);
        }
        if (top.keys.has(key)) duplicate = key;
        top.keys.add(key);
        top.expectKey = false;
      }
      continue;
    }
    if (c === '{' || c === '[') {
      frames.push(c === '{' ? { keys: new Set(), expectKey: true } : null);
      if (frames.length > max) max = frames.length;
    } else if (c === '}' || c === ']') {
      frames.pop();
    } else if (c === ',') {
      const top = frames[frames.length - 1];
      if (top) top.expectKey = true;
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
  return { inexact, depth: max, duplicate };
}

/** The first number literal JSON cannot carry back exactly, or null. */
export function inexactNumber(raw: string): string | null {
  return scanSource(raw).inexact;
}

export type PropertiesParse =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; code: PropertiesSourceError; detail?: string };

export type DataParse =
  | { ok: true; value: unknown }
  | { ok: false; code: PropertiesSourceError; detail?: string };

/**
 * The checks every raw-JSON editor on the node page shares (#886, #894):
 * size in UTF-8 bytes, nesting depth, syntax, numbers JSON cannot carry back
 * exactly, and duplicate keys — each a way for "valid JSON" to save something
 * other than what was typed, or to crash on the way. What differs per field is
 * the SHAPE it accepts, which the two wrappers below add.
 */
function parseJsonSource(raw: string): DataParse {
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
  if (scan.inexact) return { ok: false, code: 'unsafe-number', detail: scan.inexact };
  if (scan.duplicate !== null) return { ok: false, code: 'duplicate-key', detail: scan.duplicate };
  return { ok: true, value: parsed };
}

/**
 * Parse the Properties Source text. `properties` is a JSON OBJECT on the
 * server — an array, a scalar or a bare `null` is refused here rather than
 * handed to the API. Empty text is refused too: `{}` is how a user says "no
 * properties", and making that explicit keeps an accidental select-all-delete
 * from wiping every key on Save.
 */
export function parsePropertiesSource(raw: string): PropertiesParse {
  const r = parseJsonSource(raw);
  if (!r.ok) return r;
  if (typeof r.value !== 'object' || r.value === null || Array.isArray(r.value)) {
    return { ok: false, code: 'not-object' };
  }
  return { ok: true, value: r.value as Record<string, unknown> };
}

/**
 * Parse the Data tab's Source text (#894). `Node.data` is any JSON value — an
 * object, an array or a scalar — EXCEPT a top-level `null`: the column is a
 * Prisma `Json?` that this surface cannot write a bare null into, so clearing
 * is not offered here.
 */
export function parseDataSource(raw: string): DataParse {
  const r = parseJsonSource(raw);
  if (!r.ok) return r;
  if (r.value === null) return { ok: false, code: 'top-level-null' };
  return r;
}

/**
 * JSON with object keys sorted at every depth, so two bags that differ only in
 * key ORDER compare equal. JSONB does not preserve key order, so the stored
 * bag's order is not something the user chose — comparing raw strings would
 * report a change nobody made.
 */
export function canonicalJson(value: unknown): string {
  // ITERATIVE, with an explicit stack (@codex on #893): the recursive version
  // overflowed on a deeply nested bag, and the bag a node already STORES was
  // never checked by the Source view's depth limit — another writer can have
  // put it there — so it crashed the page as soon as the draft synced on load.
  // Same output as JSON.stringify over a key-sorted copy: `undefined` and
  // functions are dropped from objects and written as null in arrays, and a
  // non-finite number is written as null.
  type Frame = { lit: string } | { val: unknown };
  const out: string[] = [];
  const stack: Frame[] = [{ val: value }];
  const skip = (v: unknown) => v === undefined || typeof v === 'function' || typeof v === 'symbol';
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if ('lit' in frame) {
      out.push(frame.lit);
      continue;
    }
    const v = frame.val;
    if (Array.isArray(v)) {
      const parts: Frame[] = [{ lit: '[' }];
      v.forEach((el, i) => {
        if (i > 0) parts.push({ lit: ',' });
        parts.push(skip(el) ? { lit: 'null' } : { val: el });
      });
      parts.push({ lit: ']' });
      for (let k = parts.length - 1; k >= 0; k--) stack.push(parts[k]);
    } else if (v !== null && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => !skip(obj[k]))
        .sort();
      const parts: Frame[] = [{ lit: '{' }];
      keys.forEach((k, i) => {
        parts.push({ lit: `${i > 0 ? ',' : ''}${JSON.stringify(k)}:` });
        parts.push({ val: obj[k] });
      });
      parts.push({ lit: '}' });
      for (let k = parts.length - 1; k >= 0; k--) stack.push(parts[k]);
    } else {
      out.push(JSON.stringify(v) ?? 'null');
    }
  }
  return out.join('');
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
export async function jsonFingerprint(value: unknown, opts: { nullIsEmpty?: boolean } = {}): Promise<string> {
  // `nullIsEmpty` (the default) is the PROPERTIES rule: the server stores
  // either for an empty bag, so they are one state. For DATA they are not —
  // `{}` over absent data is a real change — and collapsing them let a stale
  // save pass the guard after another editor had written `{}` (@codex on
  // #896). Callers for data pass `nullIsEmpty: false`.
  const canonical = canonicalJson(opts.nullIsEmpty === false ? (value ?? null) : value == null ? {} : value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A well-formed fingerprint: 64 lowercase hex digits. */
export function isFingerprint(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}

/** The Properties editor's name for `jsonFingerprint` — one function, both fields. */
export const propertiesFingerprint = jsonFingerprint;
