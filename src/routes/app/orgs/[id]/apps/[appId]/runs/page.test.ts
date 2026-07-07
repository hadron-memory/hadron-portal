/**
 * Runs list SSR smoke (#478 phase 3): status chips, trigger provenance,
 * failure codes, and the teaching empty state.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
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

function renderPage(runs: unknown[], status: string | null = null) {
  return render(Page, {
    props: {
      data: { app, runs, total: runs.length, page: 1, pageSize: 25, status } as never,
    },
  }).body;
}

describe('runs list (#478)', () => {
  it('renders status, trigger, entry loc, duration, and failure code', () => {
    const body = renderPage([
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
    expect(body).toContain('/app/orgs/org-1/apps/app-1/runs/run-2');
  });

  it('teaches triggers in the unfiltered empty state', () => {
    const body = renderPage([]);
    expect(body).toContain('No runs yet');
    expect(body).toContain('schedule');
    expect(body).toContain('Test flow');
  });

  it('keeps the empty state terse when a status filter is active', () => {
    const body = renderPage([], 'FAILED');
    expect(body).toContain('No runs with this status yet');
    expect(body).not.toContain('No runs yet.');
  });
});
