/**
 * #927 — a posted `Node.revision`, the precondition an inline editor saves
 * against: a positive 32-bit integer (the server's own bound on
 * `expectedRevision`), or null for anything else.
 */
export function parseExpectedRevision(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 2_147_483_647 ? n : null;
}
