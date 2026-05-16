/**
 * Compose a canonical node URN from a memory URN and a value (loc, or PK
 * as a defect-fallback chosen by the caller). Strict at input: throws on
 * wrong-type prefix, empty inputs. Forgiving at shape: accepts the memory
 * URN with or without its `urn:memory:` prefix, AND with either spec-010
 * single-`:` grammar OR spec-021 `::` grammar (during the migration period,
 * both coexist).
 *
 * Spec history:
 *   - spec 010 (always-show-full-urn): introduced this composer, joined
 *     memory-slug-path and value with single `:`.
 *   - spec 021 (urn-composition) FR-009: hierarchy separator changed
 *     from `:` to `::`. The composer joins memory-path and value with
 *     `::`; the value (node loc) keeps its internal `:` separators
 *     unchanged.
 *
 * Mixed-grammar handling: during the spec-021 online migration, some
 * memory rows still carry legacy single-`:` URNs. To keep the composed
 * output spec-021-parseable, this function detects a legacy slug-path
 * (no `::`) and rewrites every `:` to `::` before composing — the
 * result is always a well-formed spec-021 node URN. This is a
 * transitional convenience; once migration completes, every memory URN
 * the portal sees will already be in spec-021 form.
 *
 * Example (spec-021 install-shape memory):
 *   memoryUrn: urn:memory:micromentor.org::coding-app::coding-agent::system
 *   value:     review:sort-imports
 *   result:    urn:node:micromentor.org::coding-app::coding-agent::system::review:sort-imports
 *
 * Example (legacy single-`:` memory):
 *   memoryUrn: urn:memory:hadronmemory.com:dev
 *   value:     auth:tokens
 *   result:    urn:node:hadronmemory.com::dev::auth:tokens
 *              (slug-path auto-converted from `hadronmemory.com:dev` to
 *              `hadronmemory.com::dev` so the result parses cleanly)
 *
 * The result is in `urn:node:` form. D11 cat 2 (node-role polymorphism —
 * rewrite to `urn:<role>:...` when the node has a known role) is a
 * RESOLVER-LAYER concern and not applied here; the resolver has DB
 * access to look up the node's role.
 */
export function composeNodeUrn(memoryUrn: string, value: string): string {
  if (!memoryUrn) {
    throw new Error('composeNodeUrn: memoryUrn is empty');
  }
  if (!value) {
    throw new Error('composeNodeUrn: value is empty');
  }

  let slugPath: string;
  if (memoryUrn.startsWith('urn:memory:')) {
    slugPath = memoryUrn.slice('urn:memory:'.length);
  } else if (memoryUrn.startsWith('urn:')) {
    // Wrong-type prefix — silent coercion is a security risk (the wrong
    // owner URN could resolve to an unauthorized resource downstream).
    throw new Error(
      `composeNodeUrn: memoryUrn must start with 'urn:memory:' or be a bare slug-path; got '${memoryUrn}'`,
    );
  } else {
    slugPath = memoryUrn;
  }

  // If the slug-path is in legacy single-`:` grammar (no `::`), rewrite
  // every `:` to `::` so the composed result is spec-021-parseable
  // (first-segment-must-be-one-atom rule). Spec-021 slug-paths already
  // contain `::` and pass through unchanged.
  if (!slugPath.includes('::')) {
    slugPath = slugPath.split(':').join('::');
  }

  // Spec 021 FR-009: hierarchy separator is `::`. The memory's slug-path
  // is one or more `::`-separated path-segments; appending the loc adds
  // one more `::`-separated piece. Internally the loc keeps its own `:`
  // separators unchanged (node locs are intra-memory paths, not
  // hierarchy-separated by `::`).
  return `urn:node:${slugPath}::${value}`;
}
