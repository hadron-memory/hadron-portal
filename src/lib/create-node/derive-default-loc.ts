/**
 * Spec 011-create-node-on-portal — derive a default loc segment from a
 * user-typed name, with collision suffixing against existing locs at the
 * same parent.
 *
 * Slug rules (mirror the server-side `validateLoc` regex `/^[a-zA-Z0-9_-]+$/`
 * applied per segment):
 *   - lowercase ASCII
 *   - whitespace and underscores → single hyphen
 *   - any other non-allowed char → stripped
 *   - leading/trailing hyphens trimmed
 *   - empty result → fallback to 'untitled'
 *
 * Collision behavior (matches the spec 009 `derive-default-urn` pattern):
 * if `${parentLoc ? parentLoc + ':' : ''}${slug}` is already in
 * `existingLocs`, suffix `-2`, `-3`, … on the slug until free.
 *
 * The check is purely client-side pre-fill. The server's `loc` uniqueness
 * constraint is the final gate; the user can also edit the loc by hand
 * before submit.
 */
export function deriveDefaultLoc(
  name: string,
  parentLoc: string,
  existingLocs: string[],
): string {
  const base = slugify(name);
  const taken = new Set(existingLocs);
  const fullLoc = (segment: string): string =>
    parentLoc ? `${parentLoc}:${segment}` : segment;

  if (!taken.has(fullLoc(base))) return base;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(fullLoc(candidate))) return candidate;
  }
  // 10k collisions at a single parent loc is implausible. Return the base
  // and let the server's uniqueness constraint surface the conflict in the
  // form's error mapping.
  return base;
}

/**
 * Internal slugifier — exported for the test suite. Implements the rules
 * documented above.
 */
export function slugify(raw: string): string {
  const lowered = raw.toLowerCase().trim();
  // Whitespace and underscore → hyphen
  const dehyphened = lowered.replace(/[\s_]+/g, '-');
  // Strip non-allowed chars
  const stripped = dehyphened.replace(/[^a-z0-9-]/g, '');
  // Collapse runs of hyphens, trim leading/trailing
  const collapsed = stripped.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return collapsed || 'untitled';
}
