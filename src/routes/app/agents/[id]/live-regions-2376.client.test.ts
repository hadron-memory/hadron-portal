/**
 * portal#2376 (slice 3 of #2344): the boot tab's "not available" notes and the Bundled agents
 * "list may be incomplete" note sit in a region that is mounted before they speak.
 * Each pin is before/during/after: the region exists EMPTY, holds the text, is the SAME element after.
 */
import { afterEach, describe, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { expectRegionLifecycle } from '$lib/test/statusRegionLifecycle';
import type { BootSourceView } from '$lib/server/boot-source';
import Page from './+page.svelte';
import { pageData } from './page-fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function open(extra: Record<string, unknown> = {}) {
  const data = { ...(await pageData('a', { mentionOnly: false })), canManageAgent: true, ...extra };
  const props = reactiveProps<Record<string, unknown>>({ data, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  return { root: m.target, props };
}
const setData = (props: Record<string, unknown>, patch: Record<string, unknown>) => {
  props.data = { ...(props.data as Record<string, unknown>), ...patch };
};

describe('agent boot tab: the not-available notes are in a persistent status region', () => {
  const legacy = { mode: 'legacy' } as BootSourceView;

  it('"points at a compiled prompt but has no source" (source-missing, cannot start): empty, then text, then the same element', async () => {
    const { root, props } = await open({ bootSource: legacy });
    await expectRegionLifecycle(
      root,
      'points at a compiled prompt but has no source to edit',
      () => setData(props, { bootSource: { mode: 'source-missing', compiled: null, canStart: false } }),
      () => setData(props, { bootSource: legacy }),
      () => tick(),
    );
  });

  it('"can’t see this Agent’s boot prompt" (source-unreadable): empty, then text, then the same element', async () => {
    const { root, props } = await open({ bootSource: legacy });
    await expectRegionLifecycle(
      root,
      'You can’t see this Agent’s boot prompt.',
      () => setData(props, { bootSource: { mode: 'source-unreadable' } }),
      () => setData(props, { bootSource: legacy }),
      () => tick(),
    );
  });
});

describe('agent Bundled agents tab: the incomplete-list note is in a persistent status region', () => {
  it('"may be incomplete": empty, then text, then the same element', async () => {
    // The tab is offered because there is something to add; the note is the only thing that flips.
    const helper = { id: 'ag-helper', name: 'Helper', urn: 'hrn:agent:acme.com:helper' };
    const { root, props } = await open({ bundledAgents: [], bundleCandidates: [helper], bundledMayBeIncomplete: false });
    [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Bundled agents')!.click();
    flushSync();
    await tick();
    await expectRegionLifecycle(
      root,
      'This list may be incomplete because some installed agents aren’t visible to you.',
      () => setData(props, { bundledMayBeIncomplete: true }),
      () => setData(props, { bundledMayBeIncomplete: false }),
      () => tick(),
    );
  });
});
