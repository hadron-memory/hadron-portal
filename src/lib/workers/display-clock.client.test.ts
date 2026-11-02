/**
 * portal#1495 P3 — the page display clock. Seeded from the loader (SSR and
 * first client render agree), advanced in the browser every 30 s by the
 * recorded offset (ages stay anchored to the server-relative baseline), torn
 * down cleanly. The page-level advancing/teardown pins live in
 * page.client.test.ts; these are the module's own contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDisplayClock, DISPLAY_CLOCK_INTERVAL_MS } from './display-clock.svelte';

const SEED = '2026-10-31T12:00:00.000Z';

describe('createDisplayClock (portal#1495 P3)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is seeded from the loader clock before start, with no timer running (the SSR half)', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-11-02T04:00:00.000Z');
    const clock = createDisplayClock(SEED);
    // The browser clock is two days ahead of the seed; the seed wins until start.
    expect(clock.now).toBe(Date.parse(SEED));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('falls back to the browser clock when the loader sent nothing', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-11-02T04:00:00.000Z');
    expect(createDisplayClock(null).now).toBe(Date.parse('2026-11-02T04:00:00.000Z'));
  });

  it('advances every 30 s by the seed offset: anchored to the loader clock, never jumping to the browser clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-11-02T04:00:00.000Z');
    const seed = Date.parse(SEED);
    const clock = createDisplayClock(SEED);
    clock.start();
    expect(vi.getTimerCount()).toBe(1);
    expect(clock.now).toBe(seed); // starting records the offset; it does not jump.
    vi.advanceTimersByTime(DISPLAY_CLOCK_INTERVAL_MS);
    expect(clock.now).toBe(seed + DISPLAY_CLOCK_INTERVAL_MS);
    vi.advanceTimersByTime(DISPLAY_CLOCK_INTERVAL_MS);
    expect(clock.now).toBe(seed + 2 * DISPLAY_CLOCK_INTERVAL_MS);
    // A browser clock two days ahead never bleeds in: the baseline is the loader's.
    expect(clock.now).toBe(Date.parse(SEED) + 60_000);
  });

  it('stop clears the interval and freezes the clock; safe when never started', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-11-02T04:00:00.000Z');
    const clock = createDisplayClock(SEED);
    clock.stop(); // never started: a no-op, not a throw
    clock.start();
    clock.stop();
    expect(vi.getTimerCount()).toBe(0);
    const frozen = clock.now;
    vi.advanceTimersByTime(120_000);
    expect(clock.now).toBe(frozen);
  });
});
