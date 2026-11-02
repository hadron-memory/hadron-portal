/**
 * portal#1495 P3 — the page display clock. Seeded from the loader (SSR and
 * first client render agree), advanced in the browser every 30 s by the
 * recorded offset (ages stay anchored to the server-relative baseline), torn
 * down cleanly. The page-level advancing/teardown pins live in
 * page.client.test.ts; these are the module's own contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '$lib/test/mountComponent';
import ClockHost from '$lib/test/fixtures/ClockHost.svelte';
import { createDisplayClock, DISPLAY_CLOCK_INTERVAL_MS } from './display-clock.svelte';

const SEED = '2026-10-31T12:00:00.000Z';

const mounted: ReturnType<typeof mountComponent>[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

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

  // LOCAL P3 (#1618, Gemma): pages mount the clock from an `$effect` —
  // `clock.start(); return clock.stop;`. When `start()` read `now` while
  // recording the offset, that read made the effect depend on every tick, so
  // each 30 s the effect re-ran and tore down and re-created the interval.
  // The clock still advanced (the re-armed interval saw to that), which is
  // why only the SET-INTERVAL call count exposes it: one interval for the
  // page's whole mounted life, across ticks.
  it('mounting effect does not re-create the interval on each tick (#1618 LOCAL P3)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-11-02T04:00:00.000Z');
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const m = mountComponent(ClockHost, { seed: SEED });
    mounted.push(m);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3 * DISPLAY_CLOCK_INTERVAL_MS);
    // The clock still advanced across all three ticks…
    expect(m.target.textContent).toBe(String(Date.parse(SEED) + 3 * DISPLAY_CLOCK_INTERVAL_MS));
    // …through the ONE interval mount created — not a re-created one per tick.
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    setIntervalSpy.mockRestore();
  });
});
