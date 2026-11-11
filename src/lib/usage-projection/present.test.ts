import { expect, it } from 'vitest';
import { render } from 'svelte/server';
import Windows from '$lib/components/usage/UsageWindows.svelte';
import { percent, reasonText, snapshotAge } from './present';
const window = { window: 'FIVE_HOUR', lengthMinutes: 300, status: 'PROJECTED', reason: null, usedPct: 20, lowPctAtReset: 40, highPctAtReset: 60, ceilingPct: 85, resetsAt: '2026-11-11T04:00:00Z', observedAt: '2026-11-11T01:00:00Z', confidence: 'HIGH', shape: 'FLAT', burn: { lowPctPerHour: 3, highPctPerHour: 4 }, perWorkerBurn: { lowPctPerHour: 1, highPctPerHour: 2 }, runsOutAt: null };
const html = (over = {}) => render(Windows, { windows: [{ ...window, ...over }] as never }).body;
it('server ranges pass through (no extrapolation)', () => {
  expect(html()).toContain('40–60%'); expect(html({ lowPctAtReset: 41, highPctAtReset: 59 })).toContain('41–59%');
});
it('run-out appears only if the server returns it', () => {
  expect(html()).not.toContain('Runs out'); expect(html({ runsOutAt: window.resetsAt })).toContain('Runs out');
});
it.each(['UNKNOWN', 'INSUFFICIENT_DATA'])('status %s suppresses every number even with unexpected populated fields', status => {
  const markup = html({ status, reason: status === 'UNKNOWN' ? 'STALE' : 'LOW_USE', runsOutAt: window.resetsAt });
  expect(markup).not.toContain('40–60%'); expect(markup).not.toContain('Runs out'); expect(markup).not.toContain('85%'); expect(markup).not.toContain('1–2');
});
it('stale means unknown, not zero, and future reasons cannot crash', () => {
  expect(html({ status: 'UNKNOWN', reason: 'STALE', usedPct: null })).toContain('unknown, not zero');
  expect(reasonText('__proto__')).toContain('server'); expect(reasonText('FUTURE_REASON')).toContain('server');
});
it('format precision and snapshot age use the server asOf', () => {
  expect(percent(0.2)).toBe('<1%'); expect(percent(40)).toBe('40%');
  expect(snapshotAge('2026-11-11T00:48:00Z', '2026-11-11T01:00:00Z')).toBe('12 min ago');
});
