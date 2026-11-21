/**
 * portal#2376 (slice 3 of #2344): the vector-index health check's two warnings sit in regions that
 * are mounted before the check runs. The result lands through the `form` prop, so the pins flip it:
 * the region EXISTS and is EMPTY, holds the note, and is the SAME element when the result is cleared.
 */
import { afterEach, describe, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage, page } from '$lib/test/stubs/app-stores';
import { expectLiveRegionLifecycle } from '$lib/test/expectLiveRegionLifecycle';
import { OWNER, OWNER_ID, settingsForms, settingsGraph } from './settings-page.fixture';
import Page from './+page.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };

async function open() {
  const graph = settingsGraph({ id: 'mem-A', vectorIndexEnabled: true });
  const f = await settingsForms(graph, true);
  const data = { graph, user: OWNER, ownerUserId: OWNER_ID, owner: { id: OWNER_ID, handle: 'holger', name: 'Holger' }, org: null, allOrgs: [], transferCanDelete: false, ...f } as never;
  const props = reactiveProps<Record<string, unknown>>({ data, form: null as never });
  setStubPage('http://localhost/app/memories/mem-A/settings', { id: 'mem-A' });
  page.update((p) => ({ ...p, data: data as Record<string, unknown> }));
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await settle();
  const result = (vectorHealth: Record<string, unknown> | null) => () => { props.form = (vectorHealth ? { vectorHealth } : null) as never; };
  return { root: m.target, result };
}

describe('memory settings, vector health: the warnings are persistent status regions', () => {
  it('"Showing 1 of 5 findings": empty before the check, then text, then the same element', async () => {
    const { root, result } = await open();
    await expectLiveRegionLifecycle({ root, text: 'Showing 1 of 5 findings', appear: result({ failed: [], skipped: null, truncation: { shown: 1, total: 5 } }), disappear: result(null), settle: settle });
  });

  it('"The embedding check did not run": empty before the check, then text, then the same element', async () => {
    const { root, result } = await open();
    await expectLiveRegionLifecycle({ root, text: 'The embedding check did not run: no worker', appear: result({ failed: [], skipped: 'no worker', truncation: null }), disappear: result(null), settle: settle });
  });
});
