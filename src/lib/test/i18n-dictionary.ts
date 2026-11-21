/**
 * A test-only locale for the `t()` boundary: an entry here is what a future
 * loader would resolve that id to. A string that reaches the screen through
 * `t()` shows the entry; a hard-coded literal does not, which is the whole
 * point of the pin (#1605: "Select" was a literal in four pickers).
 *
 * Use it from a test file with:
 *
 *     vi.mock('$lib/i18n/t', async (importOriginal) =>
 *       (await import('$lib/test/i18n-dictionary')).withDictionary(await importOriginal()));
 *
 * then set `dictionary[id]` in a test and `clearDictionary()` after it. With
 * the dictionary empty, `t()` behaves exactly as shipped, so the file's other
 * tests are unaffected.
 */
import type * as TModule from '$lib/i18n/t';

export const dictionary: Record<string, string> = {};

export function clearDictionary(): void {
  for (const id of Object.keys(dictionary)) delete dictionary[id];
}

export function withDictionary(actual: typeof TModule): typeof TModule {
  return {
    ...actual,
    t: (id, text, vars) => actual.t(id, dictionary[id] ?? text, vars),
  };
}

/**
 * The test locale's entry for the shared picker row button (#1605). Only the
 * visible word is translated: the accessible name is built from it, so a
 * locale that never translates `picker.select-named` still names each row
 * "Wählen <entity>" and keeps the visible label in the name.
 */
export function usePickerLocale(): void {
  dictionary['picker.select'] = 'Wählen';
}

/**
 * The per-row select button of every row: the LAST button in each row
 * (a row's URN chip renders its copy buttons first).
 */
export function rowSelectButtons(rowSelector: string): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLElement>(rowSelector)]
    .map((row) => [...row.querySelectorAll<HTMLButtonElement>('button')].at(-1))
    .filter((b): b is HTMLButtonElement => !!b);
}
