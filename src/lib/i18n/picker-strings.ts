/**
 * #1605 — the per-row button of the entity pickers (SelectMemory, SelectOrg,
 * SelectAgent, SelectUser, SelectApp, SelectNode).
 *
 * `select` is the button's visible label and the one id for that word in every
 * picker. `selectNamed` is its accessible name: the row's entity added to the
 * visible label, so a screen-reader user tabbing a list hears which entity each
 * button picks rather than "Select, button" once per row.
 *
 * The name is BUILT FROM the visible label (`{select}`), never translated as a
 * second copy of the word. That makes label in name (WCAG 2.5.3) hold by
 * construction: a locale that translates only `picker.select` still names the
 * row "<its word> <entity>", and a locale that reorders the template keeps the
 * word as long as it keeps `{select}`. Both values go through t()'s safe `fill`
 * (#817), so a `$&` or a `{select}` in an entity name stays literal.
 */
import { t } from './t';

const select = (): string => t('picker.select', 'Select');

export const pickerStrings = {
  select,
  selectNamed: (name: string): string =>
    t('picker.select-named', '{select} {name}', { select: select(), name }),
};
