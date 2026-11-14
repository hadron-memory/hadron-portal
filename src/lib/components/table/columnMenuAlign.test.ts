import { describe, expect, it } from 'vitest';
import { columnMenuAlign, COLUMN_MENU_WIDTH_PX } from './columnMenuAlign';

const W = COLUMN_MENU_WIDTH_PX;
describe('columnMenuAlign (#2149)', () => {
  it('keeps right alignment when the toggle is at the right edge (desktop)', () => {
    expect(columnMenuAlign({ right: 1180 }, W)).toBe('right');
  });
  it('hangs from the left when right alignment would clip at x<0 (390px, left-set toggle)', () => {
    // QA measured clip x=-17..159: summary right edge 159
    expect(columnMenuAlign({ right: 159 }, W)).toBe('left');
  });
  it('falls back to left when neither fits', () => {
    expect(columnMenuAlign({ right: 150 }, W)).toBe('left');
  });
});
