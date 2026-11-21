/**
 * portal#2376 (slice 3 of #2344): the memory layout's two notes sit in regions that are mounted
 * before they speak. Before/during/after: EXISTS and EMPTY, holds the text, the SAME element after.
 */
import { afterEach, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { expectRegionLifecycle } from '$lib/test/statusRegionLifecycle';
import Layout from './+layout.svelte';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; resetStubPage(); });

async function mountLayout(url: string, canWriteMemory: boolean) {
  setStubPage(url, { id: 'mem-1' });
  const props = reactiveProps<Record<string, unknown>>({
    data: {
      graph: { id: 'mem-1', urn: 'hrn:mem:acme.com:shared', name: 'Shared', class: 'knowledge', isEncrypted: false },
      canWriteMemory, nodesOff: true, nodesFailed: false, nodesTotal: null, user: { id: 'u' }, org: null,
    },
    children: createRawSnippet(() => ({ render: () => '<p>page</p>' })),
  });
  mounted = mountComponent(Layout as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  return { root: mounted.target, props };
}

it('"Read only" (ambiguous, static note): the region exists empty while the viewer can write, holds the note when they cannot, and is the same element after', async () => {
  const { root, props } = await mountLayout('http://localhost/app/memories/mem-1/info', true);
  const data = props.data as Record<string, unknown>;
  await expectRegionLifecycle(
    root,
    'Read only — editing is unavailable for this memory.',
    () => { props.data = { ...data, canWriteMemory: false }; },
    () => { props.data = { ...data, canWriteMemory: true }; },
    () => tick(),
  );
});

it('"The graph view is temporarily off": the region exists empty on another tab, holds the note on Graph, and is the same element back on that tab', async () => {
  const { root } = await mountLayout('http://localhost/app/memories/mem-1/info', true);
  await expectRegionLifecycle(
    root,
    'The graph view is temporarily off.',
    () => setStubPage('http://localhost/app/memories/mem-1/graph', { id: 'mem-1' }),
    () => setStubPage('http://localhost/app/memories/mem-1/info', { id: 'mem-1' }),
    () => tick(2),
  );
});
