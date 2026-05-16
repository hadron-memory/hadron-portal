/**
 * Client-side canonical-form helpers for spec 021.
 *
 * The portal's main job around URN canonicalization is rendering: the
 * server sends canonical URNs (per FR-031) and the portal displays them.
 * In a few places, though, the portal needs to PREVIEW a canonical-form
 * URN before submitting it (e.g., autocomplete dropdowns, "this is what
 * you'll save" displays). Those callers use the helpers here.
 *
 * Notes:
 *   - `toCanonicalForPreview` returns the parser-layer canonical only
 *     (cats 1, 4). For inputs that need cats 2 (node-role) or cats 3
 *     (path-shortening) resolution, the portal MUST round-trip to the
 *     server — the resolver layer is server-side only.
 *   - When the user types an invalid URN, helpers return `null` rather
 *     than throwing, so caller UI can render the input unchanged with
 *     a validation hint, rather than crashing.
 */

import { parseUrn, type ParsedCanonicalUrn, UrnParseError } from './parse-urn';

/**
 * Best-effort canonical-form preview. Returns the parser-layer canonical
 * form if the input parses cleanly; returns `null` otherwise. Callers in
 * autocomplete / live-validation paths use the `null` to suppress the
 * preview while the user is still typing.
 *
 * If the parsed URN still needs resolver-layer canonicalization (cats 2
 * or 3), the returned form is "tentatively canonical" — the resolver may
 * further rewrite it on save. Callers that need the FULL canonical form
 * before submission MUST round-trip to the server.
 */
export function toCanonicalForPreview(input: string): {
  canonical: string;
  needsServerCanonicalization: boolean;
} | null {
  try {
    const parsed: ParsedCanonicalUrn = parseUrn(input);
    return {
      canonical: parsed.parserCanonical,
      needsServerCanonicalization: parsed.needsResolverCanonicalization,
    };
  } catch (e) {
    if (e instanceof UrnParseError) return null;
    throw e;
  }
}

/**
 * True if `input` is in parser-layer canonical form AND doesn't need
 * resolver-layer canonicalization. Useful for "is this safe to display
 * without round-tripping the server?" checks.
 */
export function isFullyCanonical(input: string): boolean {
  try {
    const parsed = parseUrn(input);
    return (
      parsed.parserCanonical === input &&
      parsed.parserRewrites.length === 0 &&
      !parsed.needsResolverCanonicalization
    );
  } catch {
    return false;
  }
}
