/**
 * #1605 — the per-row button of the entity pickers (SelectMemory, SelectOrg,
 * SelectAgent, SelectUser, SelectApp, SelectNode).
 *
 * `selectNamed` is the button's accessible name. It starts with the visible
 * label (WCAG 2.5.3, label in name) and adds the row's entity, so a
 * screen-reader user tabbing a list hears which entity each button picks
 * rather than "Select, button" once per row. The name is interpolated through
 * t()'s safe `fill` (#817), so a `$&` in an entity name stays literal.
 */
import { t } from './t';

export const pickerStrings = {
  select: (): string => t('picker.select', 'Select'),
  selectNamed: (name: string): string => t('picker.select-named', 'Select {name}', { name }),
};
