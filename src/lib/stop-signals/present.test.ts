import { describe, expect, it } from 'vitest';
import { canLiftStops } from './present';

describe('canLiftStops', () => {
  it('needs a decisive yes and no support session', () => {
    expect(canLiftStops(null, 'yes')).toBe(true);
    expect(canLiftStops(null, 'no')).toBe(false);
    expect(canLiftStops(null, 'unknown')).toBe(false);
    expect(canLiftStops('Dana', 'yes')).toBe(false);
  });
});
