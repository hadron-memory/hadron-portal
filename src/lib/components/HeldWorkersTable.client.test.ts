/**
 * #919 — the held-workers grid, MOUNTED, so the search and sort run through
 * the real column accessors rather than a mocked row (@codex on #930: a
 * sort-only numeric rank was searchable, so "1" matched every idle worker).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import HeldWorkersTable, { type HeldWorker } from './HeldWorkersTable.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const w = (over: Partial<HeldWorker>): HeldWorker => ({
  id: 'w', name: 'X', urn: null, role: 'r', appId: 'a', appUrn: 'hrn:app:acme.com:team',
  heldAt: null, hasLiveSession: false, lastActiveAt: '2026-09-24T09:00:00Z', ...over,
});

const WORKERS = [
  w({ id: 'idle', name: 'Idle' }),
  w({ id: 'live', name: 'Live', hasLiveSession: true }),
  w({ id: 'never', name: 'Never', lastActiveAt: null }),
];

function mount(workers: HeldWorker[]) {
  const m = mountComponent(HeldWorkersTable as never, { workers } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m;
}

const names = (t: HTMLElement) => [...t.querySelectorAll('tbody a[href^="/app/workers/"]')].map((a) => a.textContent?.trim());

async function search(t: HTMLElement, text: string) {
  const box = t.querySelector<HTMLInputElement>('input[aria-label="Search the workers this user holds"]')!;
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(3);
}

describe('HeldWorkersTable — mounted', () => {
  it('lists active first by default: the rank sorts, it is not what is shown', async () => {
    // A MASKED row renders an empty state, which an alphabetical sort of the
    // shown words would put FIRST; the rank puts it last.
    const { target } = mount([...WORKERS, w({ id: 'masked', name: 'Masked', hasLiveSession: null, lastActiveAt: null })]);
    await tick(2);
    expect(names(target)).toEqual(['team/Live', 'team/Idle', 'team/Never', 'team/Masked']);
  });

  it('does not match a digit the cells never show', async () => {
    // A sort-only rank would be 0 for Live and 2 for Never. Neither row SHOWS
    // a 0 or a 2 ("Active now", "Never driven", an App URN without digits),
    // so neither may match; only the idle row, whose shown date has both, can.
    for (const digit of ['0', '2']) {
      const { target } = mount(WORKERS);
      await tick(2);
      await search(target, digit);
      expect(names(target)).toEqual(['team/Idle']);
    }
  });

  it('finds rows by the state words it shows', async () => {
    const { target } = mount(WORKERS);
    await tick(2);
    await search(target, 'never driven');
    expect(names(target)).toEqual(['team/Never']);
  });
});
