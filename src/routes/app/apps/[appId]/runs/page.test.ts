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

import Page from './+page.svelte';

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
      data: { app, runs, total: runs.length, page: 1, pageSize: 25, status, flows, runForm, ...extra } as never,
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
    expect(body).toContain('action="?/run"');
    expect(body).toContain('value="hrn:node:acme.com::flows::flows:flow1"');
    expect(body).toContain('/app/memories/m1/nodes/n1');
    // The empty state points at the Run button when flows exist.
    expect(body).toContain('hit Run on a flow above');
  });

  it('hides the Flows section when none are derivable', async () => {
    const body = await renderPage([]);
    expect(body).not.toContain('action="?/run"');
  });

  it('#1226: says some flows may be missing when the node window came back full', async () => {
    const body = await renderPage([], null, [flow], { flowsCapped: true, flowsScanned: 500 });
    expect(body).toContain('Showing the first 500 app nodes');
    expect(body).toContain('some may be missing');
  });

  it('#1226: no cue when the window was not full', async () => {
    const body = await renderPage([], null, [flow], { flowsCapped: false, flowsScanned: 12 });
    expect(body).not.toContain('Showing the first');
  });
});
