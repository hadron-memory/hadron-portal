import { parseUrn } from './parse-urn';

/**
 * Normalize a user-supplied loc input into a bare loc string suitable for
 * the moveNode / upsertNode / deleteNode mutation `loc` argument.
 *
 * The rename/move UI lets users edit the loc field, and the field has been
 * pre-populated in different shapes across the portal's history:
 *   - bare loc:                          'review:render-urn'
 *   - canonical node URN:                'urn:node:hadronmemory.com:dev:review:render-urn'
 *   - legacy loc: prefix:                'loc:review:render-urn'
 *   - wrong-type memory URN (the bug):   'urn:memory:hadronmemory.com:dev:review:render-urn'
 *   - bare memory-prefixed loc:          'hadronmemory.com:dev:review:render-urn'
 *
 * Issue #100 #4 (server-side companion to spec 010 / hadron-portal#194):
 * the rename/move flow's inline `cleanLoc` helpers stripped `urn:node:` and
 * `loc:` but NOT `urn:memory:`, so a wrong-type-prefixed loc landed at the
 * server and caused a confusing "record not found" failure (issue #100 #1).
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

  // Strip memory-URN prefix from the bare slug-path form. Heuristic: a
  // memory URN's first segment is the org slug, which is conventionally a
  // domain (contains a dot). This handles 'hadronmemory.com:dev:foo' and
  // the post-strip leftover from 'urn:memory:hadronmemory.com:dev:foo'.
  // Limitation: a future memory whose org slug doesn't contain a dot
  // (e.g., 'my-org:scratchpad:foo') wouldn't match — the heuristic would
  // need updating, or the function would need the memory URN as an
  // explicit second argument so the strip can be exact rather than
  // pattern-based.
  const parts = value.split(':');
  if (parts.length >= 3 && parts[0].includes('.')) {
    value = parts.slice(2).join(':');
  }

  return value;
}
