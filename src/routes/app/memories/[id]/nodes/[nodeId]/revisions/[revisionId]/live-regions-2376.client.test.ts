/**
 * portal#2376 (slice 3 of #2344): the revision page's "Changes" status (loading, then failed) is a
 * region that is mounted before either note speaks. The changes stream in after the page is open,
 * so the pins drive a re-load: the region EXISTS and is EMPTY while the changes are shown, holds the
 * note, and is the SAME element once they are shown again.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { expectLiveRegionLifecycle } from '$lib/test/expectLiveRegionLifecycle';
import { firstPopulatedStatusText } from '$lib/test/firstPopulatedStatusText';
import Page from './+page.svelte';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });

const revision = { id: 'r1', name: 'Earlier', loc: 'sample', tags: [], revNo: 2, createdAt: new Date(2026, 9, 19).toISOString(), content: null };
const shown = { ok: true, against: 'unknown' };
const base = { memoryId: 'mem-1', nodeId: 'node-1', revision, provenance: Promise.resolve({ ok: false }) };

async function open() {
  const props = reactiveProps<Record<string, unknown>>({ data: { ...base, changes: Promise.resolve(shown) } });
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick(3);
  const load = (changes: Promise<unknown>) => () => { props.data = { ...base, changes }; };
  return { root: mounted.target, load };
}

describe('revision page: the Changes status is a persistent status region', () => {
  it('"Couldn’t load the changes.": empty while shown, then text, then the same element', async () => {
    const { root, load } = await open();
    await expectLiveRegionLifecycle({ root, text: 'Couldn’t load the changes.', appear: load(Promise.resolve({ ok: false })), disappear: load(Promise.resolve(shown)), settle: () => tick(3) });
  });

  it('"Loading changes…": empty while shown, then text while the read is pending, then the same element', async () => {
    const { root, load } = await open();
    await expectLiveRegionLifecycle({ root, text: 'Loading changes…', appear: load(new Promise(() => {})), disappear: load(Promise.resolve(shown)), settle: () => tick(3) });
  });

  it('loading hands over to failed inside the one region, and nothing else announces', async () => {
    const { root, load } = await open();
    let fail!: (v: unknown) => void;
    load(new Promise((r) => { fail = r; }))();
    await tick(3);
    const region = [...root.querySelectorAll<HTMLElement>('[role="status"]')].find((r) => r.textContent?.includes('Loading changes…'))!;
    fail({ ok: false });
    await tick(3);
    expect(region.textContent?.trim()).toBe('Couldn’t load the changes.');
    expect(root.querySelectorAll('[role="status"]').length).toBe(1);
    expect(firstPopulatedStatusText(root)).toBe('Couldn’t load the changes.');
  });
});
