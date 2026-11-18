import { t } from '$lib/i18n/t';

/**
 * portal#1571 (hadron-server#2651) — why the assignee of a started task handed it back
 * (hrn:node:hadronmemory.com:specs:cor:agt:050:29, :01). The codes are the server's closed
 * `AgentTaskHandBackCode`; each has one plain label. Proposed in the spec, so a change to the
 * code set changes this list.
 */
export type HandBackCode = 'MISSING_INPUT' | 'CANNOT_DO' | 'REFUSED' | 'OUT_OF_SCOPE' | 'DUPLICATE';

export const HAND_BACK_TEXT_MAX = 2000;

export const HAND_BACK_CODES: { code: HandBackCode; label: string }[] = [
  { code: 'MISSING_INPUT', label: t('app.tasks.hand-back.code.missing-input', 'Missing input') },
  { code: 'CANNOT_DO', label: t('app.tasks.hand-back.code.cannot-do', 'Can’t do it') },
  { code: 'REFUSED', label: t('app.tasks.hand-back.code.refused', 'Refused') },
  { code: 'OUT_OF_SCOPE', label: t('app.tasks.hand-back.code.out-of-scope', 'Out of scope') },
  { code: 'DUPLICATE', label: t('app.tasks.hand-back.code.duplicate', 'Duplicate') },
];

/** A code's label. A code the portal doesn't know shows as itself: the reason is never hidden. */
export function handBackLabel(code: string): string {
  return HAND_BACK_CODES.find((c) => c.code === code)?.label ?? code;
}

/** The reason a form submits: a known code, and the text trimmed (blank is none, the cap applies after trimming). */
export function parseHandBack(
  code: string,
  text: string,
): { code: HandBackCode; text?: string } | { invalid: { field: 'code' | 'text'; message: string } } {
  const known = HAND_BACK_CODES.find((c) => c.code === code);
  if (!known) return { invalid: { field: 'code', message: t('app.tasks.hand-back.code-required', 'Choose a reason.') } };
  const trimmed = text.trim();
  if (trimmed.length > HAND_BACK_TEXT_MAX) {
    return { invalid: { field: 'text', message: t('app.tasks.hand-back.text-too-long', 'Keep it to {max} characters.', { max: HAND_BACK_TEXT_MAX }) } };
  }
  return trimmed ? { code: known.code, text: trimmed } : { code: known.code };
}
