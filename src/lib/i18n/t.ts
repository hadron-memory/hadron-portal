/**
 * Minimal i18n boundary. Today returns the supplied default text;
 * tomorrow can be wired to a real i18n library (svelte-i18n, etc.)
 * without changing call sites.
 *
 * Per Constitution Principle III: all user-visible strings MUST go
 * through this layer from day one, even while German and other
 * languages are not yet shipped. This stub is the v1 boundary;
 * platform-wide adoption (replacing every existing literal) is a
 * separate effort. New strings introduced by the edge-condition
 * builder route through `t(id, defaultText)` from this commit on.
 *
 * `id` is a stable lookup key (e.g. "edge-conditions.builder.add-clause").
 * `defaultText` is the English fallback that ships today.
 */

/** A value that can be substituted into a template. */
export type TemplateVars = Record<string, string | number | null | undefined>;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Substitute `{name}` placeholders — SAFELY (#817).
 *
 * The idiom this replaces was `t(...).replace('{file}', filename)`, and
 * `String.prototype.replace` expands `$&`, `` $` ``, `$'` and `$1`…`$9` **in the
 * replacement string**. Every value the portal interpolates is user- or
 * server-supplied — filenames, node and memory names, wikilink targets, and
 * `Asset.scanSignature` straight from the scan engine — so those characters are
 * reachable, not theoretical:
 *
 *     'Signature: {sig}'.replace('{sig}', 'Eicar$&Test')  → 'Signature: Eicar{sig}Test'
 *     'Download {file}'.replace('{file}', 'a$`b.txt')     → 'Download aDownload b.txt'
 *
 * `$&` is the matched text, so the PLACEHOLDER ITSELF reappears inside the
 * value; `` $` `` splices in everything before the match. Not an injection — the
 * output is escaped as text — but it silently corrupts what is displayed, and
 * it corrupts ACCESSIBLE NAMES, where the reader has no visible copy to compare
 * against (@codex on #814, filed as #817).
 *
 * A replacer FUNCTION is the fix: its return value is used verbatim, with no
 * `$` interpretation at all. Doing it here rather than at each call site makes
 * the boundary the single place this can go wrong.
 *
 * An UNKNOWN placeholder is left standing rather than blanked. `{name}` on
 * screen is a legible bug report; an empty gap is a sentence that reads as
 * finished and is missing a word — and a null/undefined value means the same
 * thing, so it takes the same path.
 */
export function fill(template: string, vars: TemplateVars): string {
  return template.replace(PLACEHOLDER, (whole, key: string) => {
    const value = vars[key];
    return value === null || value === undefined ? whole : String(value);
  });
}

export function t(id: string, defaultText: string, vars?: TemplateVars): string {
  // Stable string ids let a future loader resolve localized copy.
  // For now the default is the only shipped value.
  return vars ? fill(defaultText, vars) : defaultText;
}
