/**
 * #1766 — the org runs page renders a well-shaped unknown response enum the
 * same way as the per-app table and the run detail page: `Unknown: {raw}` in a
 * neutral chip that borrows no known state's colour or label.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import Page from './+page.svelte';
import type { AppRun } from '$lib/flow/runs';

const run = (id: string, over: Partial<AppRun> = {}): AppRun => ({
  id, appId: 'app-1', organizationId: 'org-1', agentId: null, userId: null,
  triggerKind: 'MANUAL', triggerId: null, entryNodeUrn: `hrn:node:test:memory:${id}`,
  eventData: null, policy: null, budgetTokens: null, budgetActions: null,
  status: 'COMPLETED', curNodeUrn: null, parentRunId: null, failure: null,
  timeoutMs: null, attempts: 1, startedAt: null, finishedAt: null,
  createdAt: '2026-11-01T00:00:00Z', createdBy: null, ...over,
});

const data = (runs: AppRun[]) => ({
  org: { id: 'org-1', name: 'Acme' },
  runs,
  appNames: { 'app-1': 'Digest' },
  total: runs.length,
  failed: false,
  truncated: false,
});

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

async function mountPage(runs: AppRun[]) {
  const props = reactiveProps<Record<string, unknown>>({ data: data(runs) });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  for (let i = 0; i < 8; i++) await tick();
  return m;
}

describe('org runs page: forward-compatible response enums (#1766)', () => {
  it('a well-shaped unknown status/trigger renders Unknown: raw in a neutral chip, like the table and detail page', async () => {
    const m = await mountPage([run('paused', { status: 'PAUSED', triggerKind: 'FUTURE_KIND' }), run('ok')]);
    const chips = [...m.target.querySelectorAll('tbody tr td:nth-child(2) span')] as HTMLElement[];
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent?.trim()).toBe('Unknown: PAUSED');
    expect(chips[0].className).toContain('border-zinc-300');
    expect(chips[0].className).not.toContain('amber');
    expect(chips[1].textContent?.trim()).toBe('COMPLETED');
    const trigger = m.target.querySelectorAll('tbody tr td:nth-child(4)');
    expect(trigger[0].textContent?.trim()).toBe('Unknown: FUTURE_KIND');
    expect(trigger[1].textContent?.trim()).toBe('Manual');
  });
});

describe('org runs page: the zero-match banner (portal#2378)', () => {
  it('is announced by a region that exists, empty, before the filters exclude every row', async () => {
    const m = await mountPage([run('ok')]);
    const region = () => m.target.querySelector<HTMLElement>('[data-testid="org-runs-filtered-empty"]');
    const before = region();
    expect(before, 'mounted while rows are shown').not.toBeNull();
    expect(before!.getAttribute('role')).toBe('status');
    expect(before!.textContent?.trim()).toBe('');
    const input = m.target.querySelector<HTMLInputElement>('input[type="search"], input[type="text"]')!;
    input.value = 'zzz-no-such-run';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    for (let i = 0; i < 8; i++) await tick();
    expect(region()).toBe(before);
    expect(before!.textContent).toContain('No runs match the current filters');
  });
});

describe('org runs page: the Duration order is the server\'s (portal#1499)', () => {
  const finished = (id: string, ms: number) => run(id, { startedAt: '2026-11-01T00:00:00Z', finishedAt: new Date(Date.parse('2026-11-01T00:00:00Z') + ms).toISOString() });
  const durationHeader = (m: Mounted<Record<string, unknown>>) => {
    const th = [...m.target.querySelectorAll('thead th')].find(h => h.textContent?.includes('Duration'))!;
    return (th.querySelector('button') ?? th) as HTMLElement;
  };
  const gotos = () => navigationCalls.filter(c => c.fn === 'goto').map(c => String(c.args[0]));
  const ids = (m: Mounted<Record<string, unknown>>) => [...m.target.querySelectorAll('tbody tr')].map(r => r.textContent ?? '');

  beforeEach(() => { resetNavigationCalls(); });

  it('asks the server for Duration desc then asc, and clears the pair when another column is chosen', async () => {
    const m = await mountPage([finished('a', 1000), finished('b', 5000), run('open')]);
    const header = (label: string) => { const th = [...m.target.querySelectorAll('thead th')].find(h => h.textContent?.includes(label))!; return (th.querySelector('button') ?? th) as HTMLElement; };
    for (const label of ['Duration', 'Duration', 'Started']) {
      header(label).click();
      for (let i = 0; i < 6; i++) await tick();
    }
    const calls = gotos();
    expect(calls).toHaveLength(3);
    expect(new URL(calls[0], 'https://t').searchParams.get('dir')).toBe('desc');
    expect(calls[0]).toContain('sort=duration');
    expect(calls[1]).toContain('sort=duration');
    expect(new URL(calls[1], 'https://t').searchParams.get('dir')).toBe('asc');
    expect(calls[2]).not.toContain('sort=');
  });

  it('moves the header when the URL changes without a click (back and forward)', async () => {
    const props = reactiveProps<Record<string, unknown>>({ data: { ...data([finished('a', 1000)]), sort: null, dir: 'desc' } });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    const aria = () => durationHeader(m).closest('th')?.getAttribute('aria-sort') ?? null;
    for (let i = 0; i < 8; i++) await tick();
    expect(aria()).toBeNull();
    props.data = { ...data([finished('a', 1000)]), sort: 'duration', dir: 'asc' };
    for (let i = 0; i < 8; i++) await tick();
    expect(aria()).toBe('ascending');
    props.data = { ...data([finished('a', 1000)]), sort: null, dir: 'desc' };
    for (let i = 0; i < 8; i++) await tick();
    expect(aria()).toBeNull();
    expect(gotos()).toEqual([]);
  });

  it('goes back to the most-recent truncation note when the Duration order is left', async () => {
    const props = reactiveProps<Record<string, unknown>>({ data: { ...data([finished('a', 1000)]), total: 900, truncated: true, sort: 'duration', dir: 'asc' } });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    for (let i = 0; i < 8; i++) await tick();
    expect(m.target.textContent).toContain('shortest of 900 runs by Duration');
    props.data = { ...data([finished('a', 1000)]), total: 900, truncated: true, sort: null, dir: 'desc' };
    for (let i = 0; i < 8; i++) await tick();
    expect(m.target.textContent).toContain('most recent of 900 runs');
    expect(m.target.textContent).not.toContain('by Duration');
  });

  it('puts unfinished runs last in both directions', async () => {
    const m = await mountPage([run('open'), finished('a', 1000), finished('b', 5000)]);
    durationHeader(m).click();
    for (let i = 0; i < 6; i++) await tick();
    expect(ids(m).at(-1)).toContain('open');
    durationHeader(m).click();
    for (let i = 0; i < 6; i++) await tick();
    expect(ids(m).at(-1)).toContain('open');
  });

  it('names the order in the truncation note and starts with the header on the served direction', async () => {
    const props = reactiveProps<Record<string, unknown>>({ data: { ...data([finished('a', 1000)]), total: 900, truncated: true, sort: 'duration', dir: 'desc' } });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    for (let i = 0; i < 8; i++) await tick();
    expect(m.target.textContent).toContain('longest of 900 runs by Duration');
    expect(durationHeader(m).closest('th')?.getAttribute('aria-sort')).toBe('descending');
  });
});
