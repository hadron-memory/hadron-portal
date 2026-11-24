import { describe, expect, it } from 'vitest';
import { tabIsActive } from './tab-match';

describe('tabIsActive (C2, #2568)', () => {
  const exact = { href: '/app/x/fx' };
  const prefix = { href: '/app/x/fx', match: 'prefix' as const };

  it('exact matches only its own href', () => {
    expect(tabIsActive('/app/x/fx', exact)).toBe(true);
    expect(tabIsActive('/app/x/fx/deeper', exact)).toBe(false);
  });
  it('prefix matches its href and anything below it', () => {
    expect(tabIsActive('/app/x/fx', prefix)).toBe(true);
    expect(tabIsActive('/app/x/fx/deeper', prefix)).toBe(true);
  });
  it('prefix does not match a sibling that only shares the prefix', () => {
    expect(tabIsActive('/app/x/fx-x', prefix)).toBe(false);
  });
});
