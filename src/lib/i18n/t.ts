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

export function t(id: string, defaultText: string): string {
  // Stable string ids let a future loader resolve localized copy.
  // For now the default is the only shipped value.
  return defaultText;
}
