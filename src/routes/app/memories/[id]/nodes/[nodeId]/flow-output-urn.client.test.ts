import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_QUERY } from '$lib/server/queries';
import Page from './+page.svelte';
import { load, actions } from './+page.server';
import { submitEnhanced } from '$lib/test/stubs/app-forms';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const NODE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', revision: 4,
  nodeType: 'info', alias: null, description: null, content: 'body', abstract: null,
  tokens: null, tags: [], seq: null, data: null, properties: null, ownerRepo: null,
  isRunnable: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  outgoingEdges: [], incomingEdges: [],
};
const PARENT = {
  graph: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', class: 'org', isEncrypted: false },
  graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', nodeType: 'info', tags: [] }],
  isConsumerMode: false,
  activeOrgId: 'org-1',
  org: { id: 'org-1' },
  user: { id: 'u1' },
};
beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  setStubPage('http://localhost/app/memories/mem-A/nodes/leaf-pk', { id: 'mem-A', nodeId: 'leaf-pk' });
});
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountPage() {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
  const loaded = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL('http://localhost/app/memories/mem-A/nodes/leaf-pk'),
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;
  const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...loaded }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  flushSync();
  return m.target;
}

async function openFlow() {
  const target = await mountPage();
  const tab = [...target.querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => b.textContent?.trim().startsWith('Flow'));
  expect(tab).toBeDefined();
  tab!.click();
  await tick();
  flushSync();
  return target;
}

async function enter(target: HTMLElement, value: string) {
  const input = target.querySelector<HTMLInputElement>('#flow-writeto')!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
  flushSync();
}

describe('Flow output target typed in the real page (#1529)', () => {
  it.each([
    'hrn:node:acme.com:flows:reports:daily',
    'urn:node:acme.com::writer::worker::system::reports:daily',
  ])('accepts and posts the original node ref once: %s', async (value) => {
    const target = await openFlow();
    await enter(target, value);
    const form = target.querySelector<HTMLFormElement>('form[action="?/updateFlow"]')!;
    expect(form.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(false);
    expect(await submitEnhanced(form)).toEqual({ cancelled: false });
    const fd = new FormData(form);
    expect(fd.get('outputWriteTo')).toBe(value);
    mockRequest.mockClear();
    mockRequest.mockResolvedValueOnce({ node: NODE }).mockResolvedValueOnce({});
    await actions.updateFlow({ request: { formData: async () => fd },
      params: { id: 'mem-A', nodeId: 'leaf-pk' }, locals: { token: 'tok' } } as never);
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest.mock.calls[1][1].input.data.output.writeTo).toBe(value);
  });

  it.each(['reports:daily', 'hrn:mem:acme.com:flows', 'hrn:node:acme.com:flows:'])(
    'blocks an invalid target: %s', async (value) => {
      const target = await openFlow();
      const form = target.querySelector<HTMLFormElement>('form[action="?/updateFlow"]')!;
      await enter(target, value);
      expect(form.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
      expect(form.textContent).toContain('Must be a fully-qualified node URN');
    },
  );

  it('permits an optional empty target in the real client validator', async () => {
    const target = await openFlow();
    const form = target.querySelector<HTMLFormElement>('form[action="?/updateFlow"]')!;
    await enter(target, '');
    expect(await submitEnhanced(form)).toEqual({ cancelled: false });
    expect(new FormData(form).get('outputWriteTo')).toBe('');
  });
});
