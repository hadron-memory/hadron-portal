/**
 * Runs list SSR smoke (#478 phase 3): status chips, trigger provenance,
 * failure codes, and the teaching empty state.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { runAppFlowSchema } from './schema';

// The page uses Superforms; portal vitest skips the SvelteKit plugin, so the
// SvelteKit virtual modules Superforms imports must be mocked.
vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
vi.mock('$app/navigation', () => ({
  beforeNavigate: () => {},
  afterNavigate: () => {},
  goto: vi.fn(),
  invalidateAll: vi.fn(),
}));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return {
    page: readable({
      url: new URL('https://example.test/app/orgs/org-1/apps/app-1/runs'),
      params: {},
      route: { id: null },
      status: 200,
      error: null,
      data: {},
      form: null,
    }),
  };
});

import Page from './AppRunsPanel.svelte';

const app = { id: 'app-1', name: 'Digest', organizationId: 'org-1' };

const baseRun = {
  id: 'run-1',
  organizationId: 'org-1',
  appId: 'app-1',
  agentId: null,
  userId: null,
  triggerKind: 'MANUAL' as const,
  triggerId: null,
  entryNodeUrn: 'acme.com::flows::classify',
  eventData: null,
  policy: null,
  budgetTokens: 900,
  budgetActions: 9,
  status: 'COMPLETED' as const,
  curNodeUrn: null,
  parentRunId: null,
  failure: null,
  timeoutMs: null,
  attempts: 1,
  startedAt: '1783449600000',
  finishedAt: '1783449603000',
  createdAt: '1783449599000',
  createdBy: 'user-1',
};

const flow = {
  entry: {
    id: 'n1',
    memoryId: 'm1',
    loc: 'flows:flow1',
    name: 'Flow One',
    urn: 'hrn:node:acme.com::flows::flows:flow1',
  },
  branchCount: 2,
  stepCount: 3,
};

async function renderPage(runs: unknown[], status: string | null = null, flows: unknown[] = [], extra: Record<string, unknown> = {}) {
  const runForm = await superValidate(zod4(runAppFlowSchema));
  return render(Page, {
    props: {
      data: { app, runs, total: runs.length, page: 1, pageSize: 20, statuses: status ? [status] : [], sort: 'createdAt', dir: 'desc', failed: false, status, flows, flowsPage: { offset: 0, count: flows.length, total: flows.length, previousHref: null, nextHref: null }, runForm, ...extra } as never,
      form: null,
    },
  }).body;
}

describe('runs list (#478)', () => {
  it('renders status, trigger, entry loc, duration, and failure code', async () => {
    const body = await renderPage([
      baseRun,
      {
        ...baseRun,
        id: 'run-2',
        status: 'FAILED',
        triggerKind: 'SCHEDULE',
        eventData: { scheduleName: 'morning-digest' },
        failure: { code: 'MAX_HOPS_EXCEEDED' },
      },
    ]);
    expect(body).toContain('COMPLETED');
    expect(body).toContain('Manual');
    expect(body).toContain('Schedule · morning-digest');
    expect(body).toContain('classify');
    expect(body).toContain('3s');
    expect(body).toContain('MAX_HOPS_EXCEEDED');
    expect(body).toContain('/app/apps/app-1/runs/run-2');
  });

  it('teaches triggers in the unfiltered empty state', async () => {
    const body = await renderPage([]);
    expect(body).toContain('No runs yet');
    expect(body).toContain('schedule');
    expect(body).toContain('Test flow');
  });

  it('keeps the empty state terse when a status filter is active', async () => {
    const body = await renderPage([], 'FAILED');
    expect(body).toContain('No runs with this status yet');
    expect(body).not.toContain('No runs yet.');
  });

  it('lists derived flows with step/branch counts and a Run form (#483)', async () => {
    const body = await renderPage([], null, [flow]);
    expect(body).toContain('Flow One');
    expect(body).toContain('3 steps');
    expect(body).toContain('2 branches');
    expect(body).toContain('action="?tab=runs&amp;/run"');
    expect(body).toContain('value="hrn:node:acme.com::flows::flows:flow1"');
    expect(body).toContain('/app/memories/m1/nodes/n1');
    // The empty state points at the Run button when flows exist.
    expect(body).toContain('hit Run on a flow above');
  });

  it('hides the Flows section when none are derivable', async () => {
    const body = await renderPage([]);
    expect(body).not.toContain('action="?tab=runs&amp;/run"');
  });

  it('#1881: offers a user-initiated next page instead of a capped notice', async () => {
    const body = await renderPage([], null, [flow], { flowsPage: { offset: 0, count: 20, total: 45, previousHref: null, nextHref: '/app/apps/app-1?tab=runs&flowsOffset=20' } });
    expect(body).not.toContain('Showing the first');
    expect(body).toContain('aria-label="Flow pages"');
    expect(body).toContain('href="/app/apps/app-1?tab=runs&amp;flowsOffset=20"');
  });

  it('#1881: Run actions retain a later Flow page on native and enhanced reloads', async () => {
    const body = await renderPage([], null, [flow], { flowsPage: { offset: 20, count: 20, total: 45, previousHref: '/app/apps/app-1?tab=runs', nextHref: '/app/apps/app-1?tab=runs&flowsOffset=40' } });
    expect(body).toContain('action="?tab=runs&amp;flowsOffset=20&amp;/run"');
  });

  it('#1881: zero derived flows on a populated page keeps the section and continuation reachable', async () => {
    const body = await renderPage([], null, [], { flowsPage: { offset: 0, count: 20, total: 45, previousHref: null, nextHref: '/app/apps/app-1?tab=runs&flowsOffset=20' } });
    expect(body).toContain('No flows on this page');
    expect(body).toContain('aria-label="Flow pages"');
    expect(body).not.toContain('action="?tab=runs&amp;/run"');
  });

  it('#1881: a now-empty later page keeps Previous reachable', async () => {
    const body = await renderPage([], null, [], { flowsPage: { offset: 40, count: 0, total: 45, previousHref: '/app/apps/app-1?tab=runs&flowsOffset=20', nextHref: null } });
    expect(body).toContain('No flows on this page');
    expect(body).toContain('aria-label="Flow pages"');
    expect(body).toContain('rel="prev"');
    expect(body).toContain('href="/app/apps/app-1?tab=runs&amp;flowsOffset=20"');
  });

  it('#1881: an actually empty App has no Flows section', async () => {
    const body = await renderPage([], null, [], { flowsPage: { offset: 0, count: 0, total: 0, previousHref: null, nextHref: null } });
    expect(body).not.toContain('Showing the first');
    expect(body).not.toContain('Flows');
  });

  it('#1881: a one-page list has no continuation or capped notice', async () => {
    const body = await renderPage([], null, [flow], { flowsPage: { offset: 0, count: 12, total: 12, previousHref: null, nextHref: null } });
    expect(body).not.toContain('Showing the first');
    expect(body).toContain('aria-label="Flow pages"');
    expect(body).not.toContain('rel="next"');
  });
});

// portal#1444 (hadron-server#2849): the Agent picker, only where the server would ask for one.
describe('runs list: the Agent picker (#1444)', () => {
  const agents = [
    { id: 'ag-1', name: 'Writer', urn: 'hrn:agent:x:writer' },
    { id: 'ag-2', name: 'Editor', urn: 'hrn:agent:x:editor' },
  ];

  it('several installed Agents: a labelled picker lists them by name, and each Run form carries agentRef', async () => {
    const body = await renderPage([], null, [flow], { runAgents: agents });
    expect(body).toMatch(/<label[^>]*for="runAgent"[^>]*>Run as Agent<\/label>/);
    expect(body).toContain('>Writer</option>');
    expect(body).toContain('>Editor</option>');
    expect(body).not.toContain('RUN_AGENT_REQUIRED');
    expect(body).toMatch(/<input type="hidden" name="agentRef"/);
  });

  it('one or no installed Agent: nothing new on the page', async () => {
    const body = await renderPage([], null, [flow], { runAgents: null });
    expect(body).not.toContain('id="runAgent"');
    expect(body).not.toContain('Run as Agent');
  });
});
