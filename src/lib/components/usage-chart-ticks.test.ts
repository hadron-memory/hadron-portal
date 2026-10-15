/** #1085 — the y-axis tick helpers behind UsageActivityChart. */
import { describe, expect, it } from 'vitest';
import { formatTick, tickPadLeft } from './usage-chart-ticks';

describe('formatTick', () => {
  it('is compact, with at most one decimal', () => {
    expect(formatTick(0)).toBe('0');
    expect(formatTick(2.5)).toBe('2.5');
    expect(formatTick(500)).toBe('500');
    expect(formatTick(2_500)).toBe('2.5K');
    expect(formatTick(10_000)).toBe('10K');
    expect(formatTick(250_000)).toBe('250K');
    expect(formatTick(1_000_000)).toBe('1M');
    expect(formatTick(2_500_000_000)).toBe('2.5B');
  });
});

describe('tickPadLeft', () => {
  it('never drops below the old 30px, so short labels do not move', () => {
    expect(tickPadLeft(['0', '2', '4'])).toBe(30);
  });

  it('grows with the widest label', () => {
    expect(tickPadLeft(['0', '500K', '1M'])).toBeGreaterThan(tickPadLeft(['0', '5K', '10K']));
  });
});
