import { describe, expect, it } from 'vitest';
import { columnMenuAlign } from './columnMenuAlign';

const W = 176; // w-44
describe('columnMenuAlign (#2149)', () => {
  it('keeps right alignment when the toggle is at the right edge (desktop)', () => {
    expect(columnMenuAlign({ left: 1100, right: 1180 }, W, 1280)).toBe('right');
  });
  it('hangs from the left when right alignment would clip at x<0 (390px, left-set toggle)', () => {
    // QA measured clip x=-17..159: summary right edge 159
    expect(columnMenuAlign({ left: 79, right: 159 }, W, 390)).toBe('left');
  });
  it('falls back to left when neither fits', () => {
    expect(columnMenuAlign({ left: 100, right: 150 }, W, 200)).toBe('left');
  });
});
