import { expect, it } from 'vitest';
import { render } from 'svelte/server';
import Windows from '$lib/components/usage/UsageWindows.svelte';
import { percent, range, reasonText, snapshotAge } from './present';
const window = { window: 'FIVE_HOUR', lengthMinutes: 300, status: 'PROJECTED', reason: null, usedPct: 20, lowPctAtReset: 40, highPctAtReset: 60, ceilingPct: 85, resetsAt: '2026-11-11T04:00:00Z', observedAt: '2026-11-11T01:00:00Z', confidence: 'HIGH', shape: 'FLAT', burn: { lowPctPerHour: 3, highPctPerHour: 4 }, perWorkerBurn: { lowPctPerHour: 1, highPctPerHour: 2 }, runsOutAt: null };
const html = (over = {}) => render(Windows, { props: { windows: [{ ...window, ...over }] as never } }).body;
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

it('both what-if accounts, list-only pickers and distinct read states render', async () => {
  const { default: Panel } = await import('$lib/components/usage/UsagePanel.svelte');
  const { accountKey } = await import('./identity');
  const a = { account: 'Account one', host: 'host-one', family: 'codex', newestSnapshotAt: '2026-11-11T00:48:00Z', workers: ['Ruth'], workersConfigured: true };
  const b = { ...a, account: 'Account two', host: 'host-two' };
  const base = { account: a.account, host: a.host, family: a.family, asOf: '2026-11-11T01:00:00Z', newestSnapshotAt: a.newestSnapshotAt, workers: a.workers, workersConfigured: true, windows: [window], whatIf: null };
  const view = { kind: 'ok', accounts: [a,b], complete: false, asOf: base.asOf, selected: a, invalid: false, target: b, projection: { kind:'ok', value: base }, whatIf: { kind:'ok', value: { ...base, whatIf: { adjusted: [{...window,lowPctAtReset:30, highPctAtReset:50}], target: {account:b.account, baseline:[{...window,lowPctAtReset:10,highPctAtReset:20}], adjusted:[{...window,lowPctAtReset:60,highPctAtReset:80}] } } } } };
  const show = (v: unknown) => render(Panel, { props: {view:v as never,path:'/app/apps/a/usage'} }).body;
  const markup=show(view);
  expect(markup).toContain('30–50%');expect(markup).toContain('10–20%');expect(markup).toContain('60–80%');
  expect(markup).toContain('Advisory: this changes nothing.');expect(markup).toContain('12 min ago');
  expect(markup).toContain('Ruth');expect(markup).toContain('Account two');
  expect(markup).not.toMatch(/<input[^>]*type="text"/);expect(markup).toContain('method="GET"');
  expect(markup).toContain('More accounts have history');
  expect(accountKey(a)).not.toBe(accountKey({...a,host:b.host}));
  const hidden=show({kind:'hidden'}), failed=show({kind:'failed'}), empty=show({...view,accounts:[], selected:null, projection:null,whatIf:null,complete:true});
  expect(hidden).toContain('not shown to you');expect(hidden).not.toContain('No usage history');expect(hidden).not.toContain('try again');
  expect(failed).toContain('could not be loaded');expect(empty).toContain('No usage history');
});

it('collapses equal displayed range ends and sub-1 ranges without changing numbers', () => {
  expect(range(33.6, 34.4)).toBe('34%');
  expect(range(0.2, 0.8)).toBe('<1%');
  expect(range(0, 0)).toBe('0%');
  expect(range(40, 60)).toBe('40–60%');
});
