/** portal#2376 — the Stops section's not-participant note is a persistent LiveRegion (before / during / after). */
import { afterEach, describe, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { expectLiveRegionLifecycle } from '$lib/test/expectLiveRegionLifecycle';
import Page from './AppStops.svelte';

const mounted: Mounted<Record<string, unknown>>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); document.body.innerHTML = ''; });

const ok = { kind: 'ok', value: { signals: [], pageInfo: { hasNextPage: false, endCursor: null } } };
const base = {
  page: ok, live: { signals: [], complete: true }, manages: 'yes',
  workers: [], people: {}, after: null, loadedAt: '2026-10-30T00:00:00Z', impersonating: null,
};

describe('Stops section notes', () => {
  it('not a participant', async () => {
    const props = reactiveProps<Record<string, unknown>>(base);
    const m = mountComponent(Page as never, { appId: 'app-1', panel: props } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(3);
    await expectLiveRegionLifecycle({ root: m.target, text: 'You’re not a participant in this App', settle: () => tick(2),
      appear: () => { props.page = { kind: 'not-participant' }; }, disappear: () => { props.page = ok; } });
  });
});
