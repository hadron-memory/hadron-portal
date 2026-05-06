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
 * Forward slashes are scrubbed to clean up artifacts from older bugs that
 * stored path-like locs.
 */
export function cleanLocInput(raw: string): string {
  let value = raw.trim().replace(/\//g, '');

  const parsed = parseUrn(value);
  if (parsed.type === 'node' || parsed.type === 'memory') {
    value = parsed.bareValue;
  } else if (value.startsWith('loc:')) {
    value = value.slice('loc:'.length);
  }

  // Strip memory-URN prefix (heuristic: a memory URN's first segment is a
  // domain-like string containing a dot). Catches both the bare-prefixed
  // form ('hadronmemory.com:dev:foo') and the post-strip leftover from
  // 'urn:memory:hadronmemory.com:dev:foo'.
  const parts = value.split(':');
  if (parts.length >= 3 && parts[0].includes('.')) {
    value = parts.slice(2).join(':');
  }

  return value;
}
