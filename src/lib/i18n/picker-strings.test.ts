import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDictionary, dictionary } from '$lib/test/i18n-dictionary';
import { pickerStrings } from './picker-strings';

vi.mock('$lib/i18n/t', async (importOriginal) =>
  (await import('$lib/test/i18n-dictionary')).withDictionary(await importOriginal()));

// #1605 (Gloria's BLIND P2 on #1644): label-in-name (WCAG 2.5.3) has to hold
// by construction, not by two translators happening to agree. The accessible
// name is built FROM the visible label, so a locale that translates only
// `picker.select` still yields a name that contains what is on screen.
describe('pickerStrings: the named label contains the visible label (#1605)', () => {
  afterEach(clearDictionary);

  it('carries a translated visible label into the name with no named-template entry', () => {
    dictionary['picker.select'] = 'Wählen';
    expect(pickerStrings.select()).toBe('Wählen');
    expect(pickerStrings.selectNamed('Atlas')).toBe('Wählen Atlas');
  });

  it('keeps the visible label in the name when a locale reorders the template', () => {
    dictionary['picker.select'] = 'Wählen';
    dictionary['picker.select-named'] = '{name}: {select}';
    expect(pickerStrings.selectNamed('Atlas')).toBe('Atlas: Wählen');
    expect(pickerStrings.selectNamed('Atlas')).toContain(pickerStrings.select());
  });

  it('keeps $& and a {placeholder} in an entity name literal (#817)', () => {
    expect(pickerStrings.selectNamed('a$&b')).toBe('Select a$&b');
    expect(pickerStrings.selectNamed('{select}')).toBe('Select {select}');
  });
});
