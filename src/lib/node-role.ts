/**
 * #921 — Node.role on the node page: what the metadata form sends.
 *
 * `Node.role` is an OPEN string: `spec`, `review`, a dotted sub-role such as
 * `spec.feature`, or anything a memory's authors use. It is not nodeType, not
 * objectType, not a Worker role and not an access role. The portal neither
 * closes the vocabulary nor normalises case; the server's governance and, in
 * time, a memory's MemoryConfig rules are the authority.
 */

/** Roles worth suggesting in the input. Suggestions only: never a restriction. */
export const ROLE_SUGGESTIONS: readonly string[] = ['spec', 'review'];

/**
 * The `role` to send for a save, given what the form submitted and the role
 * it was opened with (`seed`).
 *
 * - `undefined`: OMIT the field. The input was left as it was opened, so an
 *   untouched form never clears a role, and never overwrites one another
 *   writer set meanwhile (the server preserves an omitted field).
 * - `null`: CLEAR it. The user emptied a role the form opened with.
 * - a string: the role as typed, trimmed of surrounding whitespace only.
 *
 * Compared against the SEED, not against the node re-read at save time: the
 * seed is what the user saw, and only a difference from it is their edit.
 */
export function roleUpdate(submitted: string, seed: string): string | null | undefined {
  if (submitted === seed) return undefined;
  const role = submitted.trim();
  if (role === seed) return undefined;
  if (role === '') return seed === '' ? undefined : null;
  return role;
}
