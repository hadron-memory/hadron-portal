/**
 * Client-side canonical-form helpers for the grammar-v2 flat URN surface.
 *
 * The portal's main job around URN canonicalization is rendering: the
 * server sends canonical URNs (per FR-031) and the portal displays them.
 * In a few places, though, the portal needs to PREVIEW a canonical-form
 * URN before submitting it (e.g., autocomplete dropdowns, "this is what
 * you'll save" displays). Those callers use the helpers here.
 *
 * Notes:
 *   - `toCanonicalForPreview` accepts strict v2 flat URNs only.
 *     Legacy v1 chain-to-flat normalization needs the stored alias map and
 *     must round-trip through the server.
 *   - When the user types an invalid URN, helpers return `null` rather
 *     than throwing, so caller UI can render the input unchanged with
 *     a validation hint, rather than crashing.
 */

import { composeUrnV2, parseUrnV2, isFlatV2, type ParsedUrnV2, UrnParseError } from './parse-urn';

function formatParsedV2(parsed: ParsedUrnV2): string {
  const urn = composeUrnV2(parsed.type, parsed.root, ...parsed.segments);
  const fragment = parsed.fragment ? `#${parsed.fragment}` : '';
  return `${urn}${fragment}`;
}

/**
 * Best-effort v2 canonical-form preview. Returns the canonical `hrn:` flat
 * form if the input parses cleanly; returns `null` otherwise. Callers in
 * autocomplete / live-validation paths use the `null` to suppress the
 * preview while the user is still typing.
 */
export function toCanonicalForPreview(input: string): {
  canonical: string;
  needsServerCanonicalization: boolean;
} | null {
  try {
    const parsed = parseUrnV2(input);
    return {
      canonical: formatParsedV2(parsed),
      needsServerCanonicalization: false,
    };
  } catch (e) {
    if (e instanceof UrnParseError) return null;
    throw e;
  }
}

/**
 * True if `input` is already in canonical grammar-v2 flat form.
 */
export function isFullyCanonical(input: string): boolean {
  return isFlatV2(input);
}
