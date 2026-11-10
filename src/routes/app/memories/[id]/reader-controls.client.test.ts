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

it('an org-owned non-member gets no member memory actions or Settings tab (#1846)', async () => {
  setStubPage('http://localhost/app/memories/mem-1/info', { id: 'mem-1' });
  const props = reactiveProps<Record<string, unknown>>({
    data: {
      graph: {
        id: 'mem-1', urn: 'hrn:mem:acme.com:shared', name: 'Shared', class: 'knowledge',
        userId: null, organizationId: 'org-1', isEncrypted: false,
      },
      canWriteMemory: true,
      user: { id: 'stranger' },
      org: null,
    },
    children: createRawSnippet(() => ({ render: () => '<p>Readable memory content</p>' })),
  });
  mounted = mountComponent(Layout as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  mounted.target.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click();
  flushSync();
  expect(mounted.target.textContent).not.toContain('Delete memory');
  expect(mounted.target.textContent).not.toContain('Edit memory');
  expect(mounted.target.querySelector('a[href="/app/memories/mem-1/settings"]')).toBeNull();

  flushSync(() => {
    props.data = {
      ...(props.data as any),
      org: {
        id: 'org-1', name: 'Acme', urn: 'hrn:org:acme.com',
        members: [{ id: 'membership', role: 'ADMIN', user: { id: 'stranger' } }],
      },
    };
  });
  await tick();
  expect(mounted.target.textContent).toContain('Delete memory');
  expect(mounted.target.textContent).toContain('Edit memory');
  expect(mounted.target.querySelector('a[href="/app/memories/mem-1/settings"]')).not.toBeNull();
});

it('an org-anchored personal owner keeps Edit, but a share recipient does not (#1846)', async () => {
  setStubPage('http://localhost/app/memories/mem-1/info', { id: 'mem-1' });
  const props = reactiveProps<Record<string, unknown>>({
    data: {
      graph: {
        id: 'mem-1', urn: 'hrn:mem:acme.com:personal', name: 'Personal', class: 'personal',
        userId: 'owner', organizationId: 'org-1', isEncrypted: false,
      },
      canWriteMemory: true,
      user: { id: 'owner' },
      org: null,
    },
    children: createRawSnippet(() => ({ render: () => '<p>Readable memory content</p>' })),
  });
  mounted = mountComponent(Layout as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  mounted.target.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click();
  flushSync();
  expect(mounted.target.textContent).toContain('Edit memory');
  expect(mounted.target.querySelector('a[href="/app/memories/mem-1/settings"]')).not.toBeNull();

  flushSync(() => {
    props.data = { ...(props.data as any), user: { id: 'recipient' } };
  });
  await tick();
  const menu = mounted.target.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  if (menu.getAttribute('aria-expanded') === 'false') menu.click();
  flushSync();
  expect(mounted.target.textContent).not.toContain('Edit memory');
  expect(mounted.target.querySelector('a[href="/app/memories/mem-1/settings"]')).toBeNull();
});

it('an org-less personal share recipient gets no owner Settings or Edit chrome', async () => {
  setStubPage('http://localhost/app/memories/mem-1/info', { id: 'mem-1' });
  const props = reactiveProps<Record<string, unknown>>({
    data: {
      graph: {
        id: 'mem-1', urn: 'hrn:mem:owner:personal', name: 'Personal', class: 'personal',
        userId: 'owner', organizationId: null, isEncrypted: false,
      },
      canWriteMemory: true,
      user: { id: 'owner' },
      org: null,
      orgReadFailed: false,
    },
    children: createRawSnippet(() => ({ render: () => '<p>Readable memory content</p>' })),
  });
  mounted = mountComponent(Layout as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  mounted.target.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click();
  flushSync();
  expect(mounted.target.textContent).toContain('Edit memory');
  expect(mounted.target.querySelector('a[href="/app/memories/mem-1/settings"]')).not.toBeNull();

  flushSync(() => {
    props.data = { ...(props.data as any), user: { id: 'recipient' }, orgReadFailed: true };
  });
  await tick();
  const menu = mounted.target.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  if (menu.getAttribute('aria-expanded') === 'false') menu.click();
  flushSync();
  expect(mounted.target.textContent).not.toContain('Edit memory');
  expect(mounted.target.querySelector('a[href="/app/memories/mem-1/settings"]')).toBeNull();
});

// portal#1524 (Holger, 2026-10-31): the Graph tab shows a "temporarily off" note
// and renders no graph. portal#1700: the Nodes tab is back, on bounded reads.
async function mountTab(tab: string) {
  setStubPage(`http://localhost/app/memories/mem-1/${tab}`, { id: 'mem-1' });
  const props = reactiveProps<Record<string, unknown>>({
    data: {
      graph: { id: 'mem-1', urn: 'hrn:mem:acme.com:shared', name: 'Shared', class: 'knowledge', isEncrypted: false },
      canWriteMemory: true, nodesOff: true, nodesFailed: false, nodesTotal: null, user: { id: 'u' }, org: null,
    },
    children: createRawSnippet(() => ({ render: () => '<p>page</p>' })),
  });
  mounted = mountComponent(Layout as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  return mounted.target;
}

it('the graph tab says the graph view is temporarily off, with no tree, graph or error banner', async () => {
  const t = await mountTab('graph');
  expect(t.querySelector('[data-testid="memory-views-off"]')?.textContent).toContain('The graph view is temporarily off');
  expect(t.querySelector('[data-testid="lazy-nodes-browser"]')).toBeNull();
  expect(t.textContent).not.toMatch(/Couldn.t load this memory.s nodes|no nodes|0 nodes/i);
  expect(t.querySelector('svg.topic-graph, [data-testid="topic-graph"], [role="tree"]')).toBeNull();
});

it('the nodes tab renders the bounded browser, not the off note (portal#1700), and stays graph-free', async () => {
  const t = await mountTab('nodes');
  expect(t.querySelector('[data-testid="lazy-nodes-browser"]')).not.toBeNull();
  expect(t.querySelector('[data-testid="memory-views-off"]')).toBeNull();
  expect(t.querySelector('svg.topic-graph, [data-testid="topic-graph"]')).toBeNull();
});

it('a node page shows no off-note (only the Nodes and Graph tabs do)', async () => {
  setStubPage('http://localhost/app/memories/mem-1/info', { id: 'mem-1' });
  const props = reactiveProps<Record<string, unknown>>({
    data: {
      graph: { id: 'mem-1', urn: 'hrn:mem:acme.com:shared', name: 'Shared', class: 'knowledge', isEncrypted: false },
      canWriteMemory: true, nodesOff: true, nodesFailed: false, nodesTotal: null, user: { id: 'u' }, org: null,
    },
    children: createRawSnippet(() => ({ render: () => '<p>page</p>' })),
  });
  mounted = mountComponent(Layout as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  expect(mounted.target.querySelector('[data-testid="memory-views-off"]')).toBeNull();
});
