import { t } from '$lib/i18n/t';
import type { MemoryConfigWarning } from './types';

const text = (value: unknown): string | null => typeof value === 'string' ? value : null;

/**
 * Whatever a save or apply answered, as a list the page can render without
 * guarding. A row that isn't a well-formed warning is kept as a generic one: an
 * advisory the page can't describe still shouldn't vanish or throw.
 */
export function normalizeWarnings(raw: unknown): MemoryConfigWarning[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(raw, row => {
    const w = row && typeof row === 'object' ? row as Record<string, unknown> : {};
    return { code: text(w.code) ?? '', role: text(w.role) ?? '', field: text(w.field), taskUrn: text(w.taskUrn), taskState: text(w.taskState) };
  });
}

/** Rule settings that name a task, in the words a manager uses. Anything else is described generically. */
export function fieldWords(field: string | null): string | null {
  if (field === 'authorTask') return t('config.warning.field.author', 'author task');
  if (field === 'validationTask') return t('config.warning.field.validation', 'validation task');
  return null;
}

/**
 * The one piece of copy for the advisory `TASK_LESS_VISIBLE` (hadron-server#3502):
 * a task a rule points at may not be readable by everyone who reads the memory.
 * It never changes a save's success and says "may not", never "cannot".
 *
 * `urn` is the task reference exactly as the server returned it, or null. The
 * portal builds and looks up nothing, so it can't name a task the viewer can't
 * read: it only repeats a URN the server chose to send, and not even that when
 * the state says the task is unreadable or broken.
 */
export function describeWarning(w: MemoryConfigWarning): { text: string; urn: string | null } {
  const role = w.role;
  const field = w.code === 'TASK_LESS_VISIBLE' && role ? fieldWords(w.field ?? null) : null;
  if (!field) {
    return { urn: null, text: role
      ? t('config.warning.generic', 'The server returned a notice about the “{role}” rule that this page does not describe.', { role })
      : t('config.warning.generic-bare', 'The server returned a notice that this page does not describe.') };
  }
  const state = w.taskState ?? null;
  if (state === 'UNREADABLE' || state === 'BROKEN') {
    return { urn: null, text: t('config.warning.unreadable', 'The {field} of the “{role}” rule may not be readable by everyone who can read this memory. You can’t read that task yourself, or its reference is broken, so it isn’t named here.', { field, role }) };
  }
  const urn = w.taskUrn && state === 'OK' ? w.taskUrn : null;
  if (urn) return { urn, text: t('config.warning.named', 'The {field} of the “{role}” rule may not be readable by everyone who can read this memory:', { field, role }) };
  if (state === 'OK') return { urn: null, text: t('config.warning.no-ref', 'The {field} of the “{role}” rule may not be readable by everyone who can read this memory.', { field, role }) };
  return { urn: null, text: t('config.warning.unchecked', 'The check of who can read the {field} of the “{role}” rule could not be completed, so it is not known whether everyone who can read this memory can read it.', { field, role }) };
}

/** Everything the warning renders, so a grid's search finds what the reader sees. */
export function warningSearchText(w: MemoryConfigWarning): string {
  const d = describeWarning(w);
  return d.urn ? `${d.text} ${d.urn}` : d.text;
}
