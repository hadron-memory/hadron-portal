// Spec 010 display surface (renamed from `parseUrn` in spec 021 to make
// room for the new canonical-form parser at that name). Behavior here
// is unchanged.
import { parseDisplayUrn as parseUrn, splitNodeUrn } from './parse-urn';

/**
 * Normalize a user-supplied loc input into a bare loc string suitable for
 * the createNode / updateNode / deleteNode mutation `loc` argument — and,
 * since hadron-server#564 reshaped moveNode/cloneNode onto `targetUrn`, as
 * the loc segment callers compose into the full destination node URN
 * (`composeNodeUrn(memory.urn, cleanLocInput(...))`).
 *
 * The rename/move UI lets users edit the loc field, and the field has been
 * pre-populated in different shapes across the portal's history:
 *   - bare loc:                            'review:render-urn'
 *   - spec-010 canonical node URN:         'urn:node:hadronmemory.com:dev:review:render-urn'
 *   - spec-021 canonical node URN:         'urn:node:hadronmemory.com::dev::review:render-urn'
 *                                          (the loc is the FINAL `::`-segment;
 *                                           internal `:` is preserved)
 *   - grammar-v2 flat node URN (#697):     'hrn:node:hadronmemory.com:dev:review:render-urn'
 *                                          (single colon; a user-handle pool
 *                                           root has no dot, so the dotted-org
 *                                           heuristic below can't strip it —
 *                                           the lib splitter handles both)
 *   - legacy loc: prefix:                  'loc:review:render-urn'
 *   - wrong-type memory URN (the bug):     'urn:memory:hadronmemory.com:dev:review:render-urn'
 *   - bare memory-prefixed loc:            'hadronmemory.com:dev:review:render-urn'
 *
 * Spec 021 changed the URN grammar: `::` separates hierarchy levels,
 * `:` separates intra-segment slug atoms. Node locs are the FINAL
 * `::`-separated segment of a node URN — extract that segment and
 * return it verbatim.
 *
 * Forward slashes are normalized to colons. Some legacy locs were stored
 * path-style ('foo/bar/baz'); converting to colons preserves segmentation
 * rather than concatenating words into garbage ('foobarbaz').
 *
 * Asymmetric prefix handling (intentional): only `urn:node:` and
 * `urn:memory:` are stripped to a bare loc, because those are the only URN
 * types that legitimately carry a node-loc inside them. `urn:agent:`,
 * `urn:app:`, and `urn:org:` URNs pasted into a loc field are user-paste
 * mistakes — we leave them intact so the server-side mutation rejects
 * them clearly rather than silently coercing wrong-shape input into a
 * loc that resolves to a different resource.
 */
export function cleanLocInput(raw: string): string {
  let value = raw.trim().replace(/\//g, ':');

  const parsed = parseUrn(value);
  if (parsed.type === 'node' || parsed.type === 'memory') {
    value = parsed.bareValue;
  } else if (value.startsWith('loc:')) {
    value = value.slice('loc:'.length);
  }

  // Spec 021 grammar: if the value contains `::`, the loc is the FINAL
  // `::`-separated segment (and only the final segment, since hierarchy
  // is encoded by `::`). For node URNs this gives us the bare loc; for
  // memory URNs pasted into a loc field it gives us the role marker,
  // which is then rejected server-side as a wrong-shape loc (better
  // than silently coercing to a meaningless path).
  //
  // NOTE this runs BEFORE the v2 splitter below — the lib's `splitNodeUrn`
  // treats the first two atoms as the memory and would mis-split a DEEP v1
  // `::` node URN (`org::app::agent::system::loc`); the last-`::`-segment rule
  // is the correct v1 extraction.
  if (value.includes('::')) {
    const segments = value.split('::');
    return segments[segments.length - 1];
  }

  // Grammar-v2 flat node URN (#697): `<root>:<mem>:<loc…>`, single colon. The
  // lib splitter extracts the loc exactly across BOTH root kinds — a dotted org
  // root AND an undotted user-handle pool root (which the dotted-org heuristic
  // below can't strip). Only a v2 node URN reaches here with no `::`; a memory
  // URN or bare loc falls through. Guard with try/catch so a too-short value
  // (not a node URN) drops to the tolerant heuristic instead of throwing.
  if (parsed.type === 'node') {
    try {
      return splitNodeUrn(value).loc;
    } catch {
      // not a fully-qualified node URN — fall through
    }
  }

  // Legacy single-`:` grammar fallback. Strip the memory-URN prefix
  // from a bare slug-path form. Heuristic: a memory URN's first segment
  // is the org slug, conventionally a domain (contains a dot). Handles
  // 'hadronmemory.com:dev:foo' and the post-strip leftover from
  // 'urn:memory:hadronmemory.com:dev:foo'. Limitation: a memory whose
  // org slug doesn't contain a dot wouldn't match — the heuristic
  // would need updating, or the function would need the memory URN as
  // an explicit second argument so the strip can be exact rather than
  // pattern-based.
  const parts = value.split(':');
  if (parts.length >= 3 && parts[0].includes('.')) {
    value = parts.slice(2).join(':');
  }

  return value;
}
