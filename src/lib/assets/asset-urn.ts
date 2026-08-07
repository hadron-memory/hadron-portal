/**
 * Derive an asset's holding-memory URN from the asset's own URN.
 *
 * `Asset` exposes `memoryId` (an opaque id) but no `memory` relation, so the
 * cross-memory grid has no name to show and no id to link. The asset URN already
 * carries the memory, though — hadron-server emits
 * `hrn:asset:<root>:<mem-slug>:assets:<assetId>` — so the memory URN is a pure
 * string derivation. That beats resolving ids: no extra query per page, correct
 * for every memory including ones outside the first page of `memories()`, and the
 * result drops straight into `<Urn>`, which links it through the `/app/u/<urn>`
 * resolver.
 */

/** v2 emission is `hrn:asset:…`; a legacy fallback path can emit a bare form. */
const ASSET_PREFIX = /^(?:hrn|urn):asset:/;

/** The segment that separates the memory part from the asset id. */
const SEPARATOR = ':assets:';

/**
 * `hrn:asset:holger:jens:assets:<id>` → `hrn:mem:holger:jens`
 *
 * Returns null rather than guessing when the shape isn't recognised — a wrong
 * memory URN would render a link to somebody else's memory, which is worse than
 * showing no link at all.
 */
export function memoryUrnFromAssetUrn(assetUrn: string | null | undefined): string | null {
  if (!assetUrn) return null;

  const bare = assetUrn.replace(ASSET_PREFIX, '');

  // lastIndexOf, not indexOf: a memory slug is free to contain the atom
  // "assets", and the separator we want is the final one before the asset id.
  const cut = bare.lastIndexOf(SEPARATOR);
  if (cut <= 0) return null;

  const memoryPart = bare.slice(0, cut);
  if (!memoryPart) return null;

  // Nothing after the separator means a truncated URN, not a memory reference.
  if (!bare.slice(cut + SEPARATOR.length)) return null;

  // Normalise a legacy `::` hierarchy to v2's single colon. Kept lenient on
  // input by design (cor:urn:010:01 accepts v1 forever) while emitting v2.
  return `hrn:mem:${memoryPart.replaceAll('::', ':')}`;
}

/**
 * A short label for the memory, for a narrow grid column: the memory's slug
 * atoms without the `hrn:mem:<root>:` prefix, falling back to the whole thing.
 */
export function memoryLabelFromAssetUrn(assetUrn: string | null | undefined): string | null {
  const memoryUrn = memoryUrnFromAssetUrn(assetUrn);
  if (!memoryUrn) return null;
  const atoms = memoryUrn.replace(/^hrn:mem:/, '').split(':');
  // Drop the root (org name / user handle) — every row in an org-scoped view
  // shares it, so it is noise in a column this narrow.
  return atoms.length > 1 ? atoms.slice(1).join(':') : atoms.join(':');
}
