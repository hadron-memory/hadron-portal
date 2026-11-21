/**
 * portal#2376 (slice 3 of #2344): the document page's three non-document notes share a region that
 * is mounted before they speak. Before/during/after: EXISTS and EMPTY while a document shows, holds
 * the note, and is the SAME element when a document shows again.
 */
import { afterEach, describe, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { expectRegionLifecycle } from '$lib/test/statusRegionLifecycle';
import Page from './+page.svelte';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });

const ok = { state: 'ok', loc: 'cor:agt:110', name: 'Express checkout', urn: 'hrn:node:o.test:m:cor:agt:110', markdown: 'Some text.' };

async function open() {
  const props = reactiveProps<Record<string, unknown>>({ data: { document: ok, nodeHref: '/app/memories/m/nodes/n' } });
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  const show = (document: Record<string, unknown>) => () => { props.data = { document, nodeHref: '/app/memories/m/nodes/n' }; };
  return { root: mounted.target, show };
}

describe('spec document page: the not-available notes are in a persistent status region', () => {
  it('"This memory is encrypted": empty, then text, then the same element', async () => {
    const { root, show } = await open();
    await expectRegionLifecycle(root, 'This memory is encrypted, so it can’t be shown as one document.', show({ state: 'encrypted' }), show(ok), () => tick());
  });

  it('"too many specs … (the limit is 300)": empty, then text, then the same element', async () => {
    const { root, show } = await open();
    await expectRegionLifecycle(root, 'too many specs to show as one document (the limit is 300)', show({ state: 'too-large', cap: 300, limit: 'nodes' }), show(ok), () => tick());
  });

  it('"There is no document to show here": empty, then text, then the same element', async () => {
    const { root, show } = await open();
    await expectRegionLifecycle(root, 'There is no document to show here.', show({ state: 'not-found' }), show(ok), () => tick());
  });
});
