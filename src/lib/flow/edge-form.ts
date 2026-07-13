/**
 * Parsing for the edge-edit form fields both editor surfaces POST (the
 * edges/[edgeId] page and the flow-canvas panel, #510 review). Kept
 * separate from edge-editing.ts so server actions don't pull in the
 * UI-presentation helpers (and their i18n dependency).
 */

/**
 * Parse the `priority` form field. Number() + isInteger (not parseInt):
 * parseInt('1e2') === 1 and '1.5' → 1 both silently mis-parse; we want
 * to reject non-integers outright. Empty defaults to 0.
 */
export function parsePriorityField(
  raw: FormDataEntryValue | null,
): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = String(raw ?? '').trim();
  const value = trimmed === '' ? 0 : Number(trimmed);
  if (!Number.isInteger(value)) return { ok: false, error: 'Priority must be a whole number' };
  return { ok: true, value };
}

/**
 * Parse the hidden `condition` form field: the ConditionBuilder's
 * serialized JSONLogic, or the literal "null" when the condition is
 * empty (always-fires → CLEAR).
 */
export function parseConditionField(
  raw: FormDataEntryValue | null,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(String(raw ?? 'null')) };
  } catch {
    return { ok: false, error: 'Invalid condition expression' };
  }
}
