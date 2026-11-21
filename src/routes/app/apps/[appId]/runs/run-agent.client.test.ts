/**
 * portal#1444 — the choice reaches the form a Run button submits. SSR cannot
 * see this: the hidden agentRef follows the picker's store only once mounted.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { runAppFlowSchema } from './schema';
import Page from './AppRunsPanel.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';

beforeEach(() => setStubPage('http://localhost/app/apps/app-1?tab=runs', { appId: 'app-1' }));

const mounted: Mounted<Record<string, unknown>>[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const flow = {
  entry: { id: 'n1', memoryId: 'm1', loc: 'flows:one', name: 'Flow One', urn: 'hrn:node:acme.com:flows:flows:one' },
  branchCount: 1,
  stepCount: 1,
};
const agents = [
  { id: 'ag-1', name: 'Writer', urn: 'hrn:agent:x:writer' },
  { id: 'ag-2', name: 'Editor', urn: 'hrn:agent:x:editor' },
];

async function mountRuns(runAgents: unknown, overrides: Record<string, unknown> = {}) {
  const runForm = await superValidate(zod4(runAppFlowSchema), { errors: false });
  const m = mountComponent(Page as never, {
    data: {
      app: { id: 'app-1', name: 'Digest', organizationId: 'org-1' },
      runs: [], total: 0, page: 1, pageSize: 20, status: null, statuses: [], sort: 'createdAt', dir: 'desc', failed: false,
      flows: [flow], flowsPage: { offset: 0, count: 1, total: 1, firstHref: null, previousHref: null, nextHref: null }, runForm, runAgents,
      ...overrides,
    },
    form: null,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m.target;
}

const hidden = (t: HTMLElement) =>
  t.querySelector<HTMLInputElement>('form[action="?tab=runs&/run"] input[name="agentRef"]');

describe('runs page: Agent picker (#1444)', () => {
  it('choosing an Agent puts it in the Run form; unchosen, the form carries an empty agentRef', async () => {
    const t = await mountRuns(agents);
    expect(hidden(t)!.value).toBe('');
    const select = t.querySelector<HTMLSelectElement>('#runAgent')!;
    select.value = 'ag-2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(hidden(t)!.value).toBe('ag-2');
  });

  it('no picker without several Agents', async () => {
    const t = await mountRuns(null);
    expect(t.querySelector('#runAgent')).toBeNull();
  });

  // Param-only navigation reuses the page, so the form store outlives the App.
  async function navigateAtoB(runAgentsB: unknown) {
    const base = {
      app: { id: 'app-a', name: 'A', organizationId: 'org-1' },
      runs: [], total: 0, page: 1, pageSize: 20, status: null, statuses: [], sort: 'createdAt', dir: 'desc', failed: false,
      flows: [flow], flowsPage: { offset: 0, count: 1, total: 1, firstHref: null, previousHref: null, nextHref: null },
      runForm: await superValidate(zod4(runAppFlowSchema), { errors: false }),
      runAgents: agents as unknown,
    };
    const props = reactiveProps({ data: base, form: null });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    const select = m.target.querySelector<HTMLSelectElement>('#runAgent')!;
    select.value = 'ag-2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(hidden(m.target)!.value).toBe('ag-2');
    props.data = {
      ...base,
      app: { id: 'app-b', name: 'B', organizationId: 'org-1' },
      runAgents: runAgentsB,
      runForm: await superValidate(zod4(runAppFlowSchema), { errors: false }),
    };
    flushSync();
    return m.target;
  }

  it('App A\'s chosen Agent does not survive navigation to a single-Agent App B', async () => {
    const t = await navigateAtoB(null);
    expect(t.querySelector('#runAgent')).toBeNull();
    expect(hidden(t)!.value).toBe('');
  });

  it('navigating to another several-Agent App asks for a fresh choice', async () => {
    const t = await navigateAtoB(agents);
    expect(t.querySelector<HTMLSelectElement>('#runAgent')!.value).toBe('');
    expect(hidden(t)!.value).toBe('');
  });

  it('the Run action preserves the Runs page, filters, sort and Flow offset', async () => {
    setStubPage('http://localhost/app/apps/app-1?tab=runs&page=3&status=FAILED&sort=createdAt&dir=asc&flowsOffset=20', { appId: 'app-1' });
    const t = await mountRuns(agents);
    const action = t.querySelector('form')!.getAttribute('action')!;
    const [query, named] = action.slice(1).split('&/');
    const params = new URLSearchParams(query);
    expect(named).toBe('run');
    expect(params.get('tab')).toBe('runs');
    expect(params.get('page')).toBe('3');
    expect(params.get('status')).toBe('FAILED');
    expect(params.get('sort')).toBe('createdAt');
    expect(params.get('dir')).toBe('asc');
    expect(params.get('flowsOffset')).toBe('20');
  });

  // #1929 BLIND P2: a failed native Run leaves `&/run` in the page URL; the
  // next action must name `run` once, not twice.
  it('the Run action names one action even when the URL already carries one', async () => {
    setStubPage('http://localhost/app/apps/app-1?tab=runs&flowsOffset=20&/run', { appId: 'app-1' });
    const t = await mountRuns(agents);
    const action = t.querySelector('form')!.getAttribute('action')!;
    const params = new URLSearchParams(action.slice(1));
    expect([...params.keys()].filter((k) => k.startsWith('/'))).toEqual(['/run']);
    expect(params.get('flowsOffset')).toBe('20');
  });

  it('keeps a route back when a later App-node page has no flows and the total falls to zero', async () => {
    const t = await mountRuns(null, {
      flows: [],
      flowsPage: { offset: 20, count: 0, total: 0, firstHref: '?tab=runs', previousHref: '?tab=runs', nextHref: null },
    });
    expect(t.textContent).toContain('No flows on this page.');
    expect(t.querySelector('nav[aria-label="Flow pages"] a[rel="prev"]')).not.toBeNull();
  });

  it('labels the pager as a window of runnable nodes, not a count of displayed flows', async () => {
    const t = await mountRuns(null, {
      flowsPage: { offset: 0, count: 20, total: 45, firstHref: null, previousHref: null, nextHref: '?tab=runs&flowsOffset=20' },
    });
    const nav = t.querySelector('nav[aria-label="Flow pages"]');
    expect(nav).not.toBeNull();
    expect(nav!.textContent).toContain('1–20');
    expect(nav!.textContent).toContain('of 45');
    expect(t.textContent).toContain('Pages step through this App’s runnable nodes; only Flow entry nodes are listed.');
    expect(t.querySelectorAll('ul li')).toHaveLength(1);
  });

  // #2170 F7: a failed Flows read says so; it never reads as "no Flows".
  it('shows a visible Flows failure instead of hiding the section', async () => {
    const t = await mountRuns(null, {
      flows: [], flowsError: true,
      flowsPage: { offset: 0, count: 0, total: 0, firstHref: null, previousHref: null, nextHref: null },
    });
    // portal#2376: the note is the content of a persistent status region, no longer the region itself.
    const alert = t.querySelector('[data-flows-error]');
    expect(alert?.closest('[role="status"]')).not.toBeNull();
    expect(alert?.textContent).toContain('Flows couldn’t load');
    expect(t.textContent).not.toContain('No flows on this page.');
  });

  it('shows no Flows failure when the read succeeded with no Flows (control)', async () => {
    const t = await mountRuns(null, {
      flows: [], flowsError: false,
      flowsPage: { offset: 0, count: 0, total: 0, firstHref: null, previousHref: null, nextHref: null },
    });
    expect(t.querySelector('[data-flows-error]')).toBeNull();
  });
});
