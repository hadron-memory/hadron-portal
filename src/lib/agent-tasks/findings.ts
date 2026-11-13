/**
 * portal#1637 — a finished task's immutable findings (hadron-server#2662,
 * hrn:node:hadronmemory.com:specs:cor:agt:050:30), shown read-only after Result.
 *
 * Pure parts only: the page shape, runtime validation of what the provider
 * served, the offset a pager may step to, and how a finding's text is made safe
 * to read. Severity is the literal server label and means nothing to the
 * platform, so nothing here (or anywhere in the section) branches on it.
 */

/** The page size the portal asks for. The provider's own cap is {@link FINDINGS_PROVIDER_MAX}. */
export const FINDINGS_PAGE_SIZE = 20;
/** The most rows one provider page may carry (default 20, max 200). A bigger answer is malformed. */
export const FINDINGS_PROVIDER_MAX = 200;

export interface Finding {
  /** Local to the task, not an entity URN. */
  id: string;
  /** The literal server label (P1/P2/P3/note); never interpreted. */
  severity: string;
  text: string;
}

export interface FindingsPage {
  taskId: string;
  /** The offset this page was read at. */
  offset: number;
  items: Finding[];
  /** The server's total, shown as served. */
  total: number;
  /** The server's own claim that more follows; the only thing that enables Next. */
  hasMore: boolean;
}

/**
 * What a findings read answered. `no-result` (the task has no finished result)
 * is not an empty page; `unavailable` is the neutral missing-or-unreadable
 * answer; `failed` is an unknown. None of the last three may read as "no findings".
 */
export type FindingsRead =
  | { kind: 'page'; page: FindingsPage }
  | { kind: 'no-result' }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

const GRAPHQL_INT_MAX = 2147483647;

/** A decimal non-negative GraphQL Int; absent means 0. Anything else is null (the endpoint's 400). */
export function parseFindingsOffset(raw: string | null): number | null {
  if (raw === null) return 0;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n <= GRAPHQL_INT_MAX ? n : null;
}

/**
 * The page the provider served, checked at runtime rather than cast: typed
 * rows, a non-negative integer total, a boolean hasMore. An empty page that
 * claims more can never advance a pager, and a repeated id would collide as a
 * row key, so both are refused as malformed. Null means "treat as failed".
 */
export function parseFindingsPage(value: unknown): { items: Finding[]; total: number; hasMore: boolean } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { items, total, hasMore } = value as Record<string, unknown>;
  if (!Array.isArray(items) || items.length > FINDINGS_PROVIDER_MAX) return null;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) return null;
  if (typeof hasMore !== 'boolean') return null;
  if (hasMore && items.length === 0) return null;
  const seen = new Set<string>();
  const rows: Finding[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) return null;
    const { id, severity, text } = item as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || typeof severity !== 'string' || severity === '' || typeof text !== 'string') return null;
    if (seen.has(id)) return null;
    seen.add(id);
    rows.push({ id, severity, text });
  }
  return { items: rows, total, hasMore };
}

/** The next page starts after the rows actually served, never after the size that was asked for. */
export function nextFindingsOffset(page: FindingsPage): number {
  return page.offset + page.items.length;
}

/**
 * Characters that would reorder, hide or inject into what a reader sees, shown
 * as a visible `[U+XXXX]` instead of obeyed: C0 controls other than LF and TAB
 * (ESC, CR…), DEL and C1, the bidi marks/embeddings/overrides/isolates, the
 * characters that render blank (Hangul fillers, the Braille blank), and since
 * portal#2111 the zero-width and format characters that hide text (ZWSP, WORD
 * JOINER, BOM, SOFT HYPHEN, MONGOLIAN VOWEL SEPARATOR) and the whole tag block
 * U+E0000–E007F, which can smuggle invisible ASCII; and since portal#2113 the
 * invisible math operators U+2061–2064 and the LINE and PARAGRAPH SEPARATORS
 * U+2028/2029, which render blank or break a line unseen.
 *
 * Deliberately NOT here, because they are part of valid text: the emoji and
 * script joiners (U+200D ZWJ, U+200C ZWNJ), variation selectors, combining
 * marks, and a well-formed emoji tag sequence (a subdivision flag such as
 * England's: U+1F3F4, 1–6 tag letters or digits, CANCEL TAG), which the
 * first, captured alternative matches whole so its tags are never split out.
 *
 * Written with escapes only, so the set is auditable and survives copy-paste.
 * Display only; the stored text is never touched.
 */
const REVEALED = /(\u{1F3F4}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,6}\u{E007F})|[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u061C\u115F\u1160\u180E\u200B\u200E\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\u2800\u3164\uFEFF\uFFA0\u{E0000}-\u{E007F}]/gu;

export interface TextPart {
  text: string;
  /** True for a code-point marker (styled apart), false for the finding's own text. */
  marker: boolean;
}

export function findingTextParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(REVEALED)) {
    if (m[1] !== undefined) continue; // a kept emoji tag sequence stays inside the surrounding text
    if (m.index! > last) parts.push({ text: text.slice(last, m.index), marker: false });
    parts.push({ text: `[U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}]`, marker: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length || parts.length === 0) parts.push({ text: text.slice(last), marker: false });
  return parts;
}
