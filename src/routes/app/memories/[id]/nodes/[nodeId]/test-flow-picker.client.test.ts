/**
 * portal#1453 (follow-up to #1444/#1449) — the node page's "Test this flow"
 * Agent picker, mounted. The action's server tests cover what is sent once an
 * `agentRef` arrives; what only a mount can show is the page half: the chosen
 * Agent reaches the form that is posted, and moving to another App clears it
 * (an `onchange` beside `bind:value`, which a diff cannot prove).
 *
 * Mounts the REAL page with data from the REAL loader (the #995 harness), the
 * org's Apps coming from the real `ORG_APPS_RUNNABLE_QUERY` path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_QUERY, ORG_APPS_RUNNABLE_QUERY } from '$lib/server/queries';
import Page from './+page.svelte';
import { load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const NODE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', revision: 4,
  nodeType: 'info', alias: null, description: null, content: 'body', abstract: null,
  tokens: null, tags: [], seq: null, data: null, properties: null, ownerRepo: null,
  isRunnable: true, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
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
const agent = (id: string, name: string) => ({ agent: { id, name, urn: `hrn:agent:x:${id}` } });
// A and B each have several installed Agents (a picker); C has one (no picker).
const APPS = [
  { id: 'app-a', name: 'App A', appAgents: [agent('ag-a1', 'Writer A'), agent('ag-a2', 'Editor A')] },
  { id: 'app-b', name: 'App B', appAgents: [agent('ag-b1', 'Writer B'), agent('ag-b2', 'Editor B')] },
  { id: 'app-c', name: 'App C', appAgents: [agent('ag-c1', 'Only C')] },
];

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
    if (doc === ORG_APPS_RUNNABLE_QUERY) return { apps: { items: APPS, total: APPS.length } };
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

function openTestFlow(target: HTMLElement) {
  target.querySelector<HTMLButtonElement>('button[aria-label^="Actions for"]')!.click();
  flushSync();
  const item = [...target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find((b) => b.textContent?.trim() === 'Run');
  expect(item, 'the Run menu item').toBeDefined();
  item!.click();
  flushSync();
}

function choose(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

const appSelect = (t: HTMLElement) => t.querySelector<HTMLSelectElement>('#testFlowApp')!;
const agentSelect = (t: HTMLElement) => t.querySelector<HTMLSelectElement>('#testFlowAgent');
/** The field the posted form carries: the one the action reads as `agentRef`. */
const posted = (t: HTMLElement) =>
  new FormData(t.querySelector<HTMLFormElement>('form[action="?/testFlow"]')!).get('agentRef');

describe('node page Test this flow: Agent picker (#1453)', () => {
  it('offers the picker only for an App with several installed Agents', async () => {
    const t = await mountPage();
    openTestFlow(t);
    expect(agentSelect(t)).toBeNull();

    choose(appSelect(t), 'app-a');
    const options = [...agentSelect(t)!.options].map((o) => o.textContent?.trim());
    expect(options).toEqual(['Choose an Agent…', 'Writer A', 'Editor A']);

    choose(appSelect(t), 'app-c');
    expect(agentSelect(t)).toBeNull();
  });

  it('the chosen Agent reaches the posted form; unchosen it posts an empty agentRef', async () => {
    const t = await mountPage();
    openTestFlow(t);
    choose(appSelect(t), 'app-a');
    expect(posted(t)).toBe('');

    choose(agentSelect(t)!, 'ag-a2');
    expect(posted(t)).toBe('ag-a2');
  });

  it('changing the App clears the chosen Agent, to a picker App and to a single-Agent App alike', async () => {
    const t = await mountPage();
    openTestFlow(t);
    choose(appSelect(t), 'app-a');
    choose(agentSelect(t)!, 'ag-a2');
    expect(posted(t)).toBe('ag-a2');

    // To another several-Agent App: a fresh choice is required.
    choose(appSelect(t), 'app-b');
    expect(agentSelect(t)!.value).toBe('');
    expect(posted(t)).toBe('');

    // To a one-Agent App: no picker, and nothing of the earlier choice rides along.
    choose(agentSelect(t)!, 'ag-b1');
    choose(appSelect(t), 'app-c');
    expect(agentSelect(t)).toBeNull();
    expect(posted(t)).toBeNull();

    // The store was cleared too: back on a picker App, the earlier choice is gone.
    choose(appSelect(t), 'app-b');
    expect(agentSelect(t)!.value).toBe('');
    expect(posted(t)).toBe('');
  });
});
