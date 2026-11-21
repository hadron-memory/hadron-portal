/**
 * portal#2375 — the "Start a source" confirmation is announced by a status region that was
 * already mounted, empty, before the button was clicked.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { announcedStatusRegion, idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import StartBootSource from './StartBootSource.svelte';
import { bootStartSchema } from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

describe('Start a source confirmation (portal#2375)', () => {
  it('is announced in the status region that was already mounted, empty', async () => {
    const initial = await superValidate({}, zod4(bootStartSchema), { id: 'bootStart:a', errors: false });
    const m = mountComponent(StartBootSource as never, { seeded: false, initial } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick();
    const root = m.target;
    const idle = idleStatusRegions(root);
    expect(idle.length).toBeGreaterThan(0);
    expect(announcedStatusRegion(root)).toBeNull();

    [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Start a source')!.click();
    flushSync();
    await tick();
    const announced = announcedStatusRegion(root);
    expect(announced?.textContent).toContain('Once you compile and approve a revision');
    expect(idle).toContain(announced);
  });
});
