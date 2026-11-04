/**
 * portal#1701 (LOCAL P2-1) — the edit page is reused when only the schedule changes (A -> B): the form must show B,
 * not A's name, entry and timing, or Save would rewrite B with A's values.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import Page from './+page.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }), applyAction: vi.fn(), deserialize: vi.fn() }));
vi.mock('$app/environment', () => ({ browser: true, dev: false, building: false, version: 'test' }));

let mounted: Mounted<Record<string, unknown>> | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; vi.restoreAllMocks(); });

const dataFor = (ref: string, name: string, entry: string, time: string) => ({
  app: { id: 'app-1', name: 'Team', organizationId: null },
  ref,
  schedule: { name, entryNodeUrn: entry, timezone: 'Europe/Berlin', enabled: true },
  timing: { kind: 'daily', time },
  nodeMemories: { kind: 'ok', value: [] },
});

describe('edit page reused for another schedule', () => {
  it('shows B’s name, entry and time after A -> B, and keeps a same-schedule draft', async () => {
    const props = reactiveProps<Record<string, unknown>>({ data: dataFor('a', 'Alpha', 'hrn:node:x:m:a', '09:00'), form: null });
    mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    await tick(3);
    const t = mounted.target;
    const name = () => t.querySelector<HTMLInputElement>('input[name="name"]')!;
    expect(name().value).toBe('Alpha');
    name().value = 'Alpha, edited';
    name().dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    // same schedule re-read (e.g. after a save): the draft stays
    props.data = dataFor('a', 'Alpha', 'hrn:node:x:m:a', '09:00');
    flushSync();
    expect(name().value).toBe('Alpha, edited');
    // another schedule: everything is B's
    props.data = dataFor('b', 'Beta', 'hrn:node:x:m:b', '17:30');
    flushSync();
    await tick(3);
    expect(name().value).toBe('Beta');
    expect(t.querySelector<HTMLInputElement>('input[name="entryNodeUrn"]')!.value).toBe('hrn:node:x:m:b');
    expect(t.querySelector<HTMLInputElement>('input[name="time"]')!.value).toBe('17:30');
  });
});
