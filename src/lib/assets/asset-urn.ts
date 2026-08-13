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
 * A v1 OWNERSHIP CHAIN — `<org>::<app>::<agent>::<memory>`, more than two atoms
 * written with the `::` separator.
 *
 * This shape only reaches us through the `${memory.urn}:assets:${id}` fallback,
 * which copies `Memory.urn` verbatim; the normal v2 emission path has already
 * flattened via `bareAtoms`. It matters because a chain has NO string-derivable
 * v2 form — `composeNodeUrn` says so and declines to flatten one, since the
 * migration may reassign slugs and the server resolves chains through a stored
 * alias map. Flattening here would compose a URN that resolves to a DIFFERENT
 * memory, silently, with no error on either side (PR #708 review — codex P2,
 * seconded by Copilot).
 *
 * Two atoms is root + slug, not a chain: `acme::docs` → `hrn:mem:acme:docs` is
 * the documented v1→v2 rewrite and stays supported.
 */
function isOwnershipChain(memoryPart: string): boolean {
  return memoryPart.includes('::') && memoryPart.split('::').length > 2;
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

  // Strip a prefix from the memory part TOO. A legacy `memories.urn` row can hold
  // a rendered `hrn:mem:acme.com:docs`, and the NORMAL emission branch composes
  // that straight through (bareAtoms strips `@` and collapses `::` but never a
  // scheme prefix), yielding `hrn:asset:hrn:mem:acme.com:docs:assets:<id>`. Such
  // rows exist because chk_memory_urn_not_prefixed is NOT VALID — enforced on
  // write, never re-checked against pre-existing rows. Stripping only once left the
  // inner prefix in place and composed a doubled `hrn:mem:hrn:mem:…`.
  const memoryPart = bare.slice(0, cut).replace(URN_PREFIX, '');
  if (!memoryPart) return null;

  // Nothing after the separator means a truncated URN, not a memory reference.
  if (!bare.slice(cut + SEPARATOR.length)) return null;

  // A v1 ownership chain can't be flattened into v2 — returning null costs a
  // chip on a rare legacy row; guessing costs a link to the WRONG memory.
  if (isOwnershipChain(memoryPart)) return null;

  const atoms = atomsOf(memoryPart);
  if (atoms.some((a) => !a)) return null; // an empty atom means a malformed path

  // The memory part is VARIABLE-LENGTH — do not assume root + slug.
  // `composeUrnV2` has an arity rule for secret/apprun/noderev/node/edge but NONE
  // for `asset`, so a compound memory urn lengthens the URN instead of being
  // rejected. `mentor-co:juno:mike-personal` is in prisma/seed.ts, so three atoms
  // is real, not hypothetical — see
  // hadronmemory.com:hadron-server:findings:asset-urn-shapes-are-variable.
  //
  // Requiring exactly two declined that memory's assets outright (no chip at all).
  // The floor is two: a single atom is the `hrn:asset:unknown:assets:<id>`
  // sentinel the server emits when it cannot load the memory row, which names no
  // memory and must stay null.
  if (atoms.length < 2) return null;

  return `hrn:mem:${atoms.join(':')}`;
}
