import { afterEach, expect, it } from 'vitest';
import { createRawSnippet, flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import Layout from './+layout.svelte';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); resetStubPage(); });

it('reader keeps the memory readable without Add/Edit; a writer gets the controls', async () => {
  setStubPage('http://localhost/app/memories/mem-1/info', { id: 'mem-1' });
  const props = reactiveProps<Record<string, unknown>>({
    data: {
      graph: { id: 'mem-1', urn: 'hrn:mem:acme.com:shared', name: 'Shared', class: 'knowledge', isEncrypted: false },
      canWriteMemory: false, graphNodes: [], user: { id: 'reader' }, org: null,
    },
    children: createRawSnippet(() => ({ render: () => '<p>Readable memory content</p>' })),
  });
  mounted = mountComponent(Layout as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  const target = mounted.target;
  expect(target.textContent).toContain('Read only');
  expect(target.textContent).toContain('Readable memory content');
  target.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click();
  flushSync();
  expect(target.textContent).not.toContain('Add node');
  expect(target.textContent).not.toContain('Edit memory');
  flushSync(() => { props.data = { ...(props.data as any), canWriteMemory: true }; });
  await tick();
  expect(target.textContent).toContain('Add node');
  expect(target.textContent).toContain('Edit memory');
});
