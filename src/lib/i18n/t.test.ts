import { describe, it, expect } from 'vitest';
import { t } from './t.js';

describe('i18n stub', () => {
  it('returns the default text unchanged for any id', () => {
    expect(t('edge-conditions.builder.add-clause', 'Add clause')).toBe('Add clause');
    expect(t('any.id.at.all', 'whatever')).toBe('whatever');
  });

  it('does not mutate or trim the default text', () => {
    expect(t('id', '  Lots of  spaces  ')).toBe('  Lots of  spaces  ');
    expect(t('id', 'Multi\nline\ntext')).toBe('Multi\nline\ntext');
  });
});
