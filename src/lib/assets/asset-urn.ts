/**
 * Derive an asset's holding-memory URN from the asset's own URN.
 *
 * `Asset` exposes `memoryId` (an opaque id) but no `memory` relation, so the
 * cross-memory grid has no name to show and no id to link. The asset URN already
 * carries the memory, though, so this is a pure string derivation — no per-page
 * fan-out, and correct for memories outside the first page of `memories()`.
 *
 * ## The shapes this has to accept
 *
 * `Asset.urn`'s resolver (hadron-server `resolvers.types.ts`) is:
 *
 *     emitAssetUrnV2(memory.urn, id)   →  hrn:asset:<root>:<mem…>:assets:<id>
 *
 * with two fallbacks that produce DIFFERENT prefixes, which is why the prefix
 * strip below is permissive rather than a single literal:
 *
 *   - on emission failure it returns `${memory.urn}:assets:${id}` — so whatever
 *     `Memory.urn` happens to hold, prefixed or bare, lands here verbatim;
 *   - a memory it can't load yields `hrn:asset:unknown:assets:<id>`.
 *
 * (The `Asset.urn` SDL docstring still describes the pre-#697 form,
 * `<memory.urn>:assets:<asset.id>`. The resolver is the contract; the docstring
 * lags it. Both parse here.)
 */

/**
 * Leading `<scheme>:<type>:` for any type that can front an asset URN. `mem` and
 * `memory` appear via the `${memory.urn}:assets:${id}` fallback; without them a
 * stored `hrn:mem:holger:jens` would survive the strip and compose into a
 * doubled `hrn:mem:hrn:mem:holger:jens`.
 */
const URN_PREFIX = /^(?:hrn|urn):(?:asset|mem|memory):/;

/** The segment that separates the memory part from the asset id. */
const SEPARATOR = ':assets:';

/**
 * Split the memory part into atoms, in whichever grammar it arrived.
 *
 * A v1 `::` hierarchy and a v2 single-colon path are both possible: the v2
 * emitter feeds `bareAtoms(memory.urn)` through `composeUrnV2`, so even a legacy
 * CHAIN memory comes out single-colon.
 */
function atomsOf(memoryPart: string): string[] {
  return memoryPart.includes('::') ? memoryPart.split('::') : memoryPart.split(':');
}

/**
 * `hrn:asset:holger:jens:assets:<id>` → `hrn:mem:holger:jens`
 *
 * Returns null rather than guessing when the shape isn't recognised — a wrong
 * memory URN would render a link to somebody else's memory, which is worse than
 * showing no link at all.
 */
export function memoryUrnFromAssetUrn(assetUrn: string | null | undefined): string | null {
  if (!assetUrn) return null;

  const bare = assetUrn.replace(URN_PREFIX, '');

  // lastIndexOf, not indexOf: a memory slug is free to contain the atom
  // "assets", and the separator we want is the final one before the asset id.
  const cut = bare.lastIndexOf(SEPARATOR);
  if (cut <= 0) return null;

  const memoryPart = bare.slice(0, cut);
  if (!memoryPart) return null;

  // Nothing after the separator means a truncated URN, not a memory reference.
  if (!bare.slice(cut + SEPARATOR.length)) return null;

  const atoms = atomsOf(memoryPart);
  if (atoms.some((a) => !a)) return null; // an empty atom means a malformed path

  // A v2 memory is root + slug, exactly two atoms (cor:urn:010:01). MORE than two
  // is a legacy OWNERSHIP CHAIN (<org>::<app>::<agent>::<memory>) — the shape v2
  // removed — and it has NO string-derivable v2 form: v2's fixed positional arity
  // would read atom 1 as the whole memory slug and fold the rest in after it,
  // silently addressing a different memory. Migration may also have reassigned
  // slugs, so the flat spelling can't be computed at all.
  //
  // So emit a chain unchanged, in v1 (`hrn:memory:a::b::c`), which the server
  // accepts forever and resolves through its stored alias map. Same rule
  // `composeNodeUrn` implements for node URNs — flattening one is a correctness
  // bug, not a modernisation (PR #704 review, codex P1).
  if (atoms.length > 2) return `hrn:memory:${atoms.join('::')}`;

  return `hrn:mem:${atoms.join(':')}`;
}
