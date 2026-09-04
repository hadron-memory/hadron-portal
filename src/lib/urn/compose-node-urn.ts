import { CANONICAL_SCHEME, hasSchemePrefix, normalizeScheme } from './parse-urn';

/**
 * Compose a canonical node URN from a memory URN and a value (loc, or PK
 * as a defect-fallback chosen by the caller). Strict at input: throws on
 * wrong-type prefix, empty inputs. Forgiving at shape: accepts the memory
 * URN with or without its `hrn:mem:` / `hrn:memory:` prefix, and in either
 * grammar.
 *
 * ## Emits grammar v2 (flat, single-colon)
 *
 * Per [`cor:urn:010:01`](hrn:node:hadronmemory.com:specs:cor:urn:010:01), a v2
 * node URN is `hrn:node:<root>:<memory-slug>:<loc>` — **single colon
 * throughout**. The `::` hierarchy separator is v1; the platform emits v2
 * (#697/#720) and `parseUrnV2` rejects `::` outright. v1 stays accepted on
 * *input* forever, which is why this composer still takes it.
 *
 *   memoryUrn: hrn:mem:hadronmemory.com:dev   (or the v1 `hadronmemory.com::dev`)
 *   value:     auth:tokens
 *   result:    hrn:node:hadronmemory.com:dev:auth:tokens
 *
 * This reverses the spec-021 FR-009 behaviour this function used to
 * implement (rewriting every `:` into `::`), which `cor:urn:010:01`
 * supersedes.
 *
 * ## The one case that stays v1: ownership chains
 *
 * A v1 memory URN with MORE than two atoms is an ownership chain
 * (`<org>::<app>::<agent>::<memory>`) — the shape v2 removed. It has no
 * string-derivable v2 form: v2's fixed positional arity would read atom 1 as
 * the memory slug and fold the rest into the loc, silently addressing the
 * wrong node. The spec is explicit that migration may reassign slugs, so
 * "an old chain URN can't be string-rewritten to its flat form" — it resolves
 * through a **stored alias map** on the server instead.
 *
 * So a chain URN is emitted unchanged in v1 form, which the server accepts
 * forever. Flattening it would be a correctness bug, not a modernization.
 *
 *   memoryUrn: hrn:memory:micromentor.org::coding-app::coding-agent::system
 *   bare-loc-ok — a loc shape being described, not a citation.
 *   value:     review:sort-imports
 *   result:    hrn:node:micromentor.org::coding-app::coding-agent::system::review:sort-imports
 *
 * The result is in `hrn:node:` form. D11 cat 2 (node-role polymorphism —
 * rewrite to `hrn:<role>:...` when the node has a known role) is a
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

  // Accept canonical `hrn:memory:`, legacy `urn:memory:` (issue #239), AND the
  // grammar-v2 `hrn:mem:` type word (#697 emission flip — the server now emits
  // `hrn:mem:<root>:<slug>` for memory URNs). All strip to the bare slug-path.
  let slugPath: string;
  const memScheme = normalizeScheme(memoryUrn);
  if (memScheme.startsWith('hrn:memory:')) {
    slugPath = memScheme.slice('hrn:memory:'.length);
  } else if (memScheme.startsWith('hrn:mem:')) {
    slugPath = memScheme.slice('hrn:mem:'.length);
  } else if (hasSchemePrefix(memoryUrn)) {
    // Wrong-type prefix — silent coercion is a security risk (the wrong
    // owner URN could resolve to an unauthorized resource downstream).
    throw new Error(
      `composeNodeUrn: memoryUrn must start with 'hrn:mem:'/'hrn:memory:' (or legacy 'urn:memory:') or be a bare slug-path; got '${memoryUrn}'`,
    );
  } else {
    slugPath = memoryUrn;
  }

  // An ownership CHAIN (>2 atoms) has no string-derivable v2 form — see the
  // doc comment. Emit it unchanged in v1 so the server's alias map resolves it.
  // Count atoms in whichever grammar the caller supplied.
  const atoms = slugPath.includes('::') ? slugPath.split('::') : slugPath.split(':');
  if (atoms.length > 2) {
    const chain = atoms.join('::');
    return `${CANONICAL_SCHEME}:node:${chain}::${value}`;
  }

  // Grammar v2 (cor:urn:010:01): flat, single colon throughout. `<root>:<slug>`
  // then the loc, whose own internal `:` separators are already v2-shaped —
  // v2 treats the loc as opaque colon-joined atoms, so it appends verbatim.
  return `${CANONICAL_SCHEME}:node:${atoms.join(':')}:${value}`;
}
