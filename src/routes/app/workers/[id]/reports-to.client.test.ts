/**
 * portal#1067 (hadron-server#1726) — the worker page's "Reports to" line.
 *
 * Masked like the hold: null is "reports to nobody" OR "you may not see", so
 * the honest rendering of null is no line at all.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import Page from './+page.svelte';

function worker(over: Record<string, unknown>) {
  return {
    id: 'w-a', appId: 'app-1', agentId: 'agent-1', name: 'Dara', slug: 'dara',
    urn: 'hrn:worker:hadronmemory.com:team:dara', role: 'engineer',
    prompt: null, memoryId: null, retiredAt: null,
    heldByUserId: null, heldAt: null, createdAt: '1789430400000',
    agent: { id: 'agent-1', name: 'Engineer', urn: 'hrn:agent:x:engineer', },
    app: { id: 'app-1', name: 'Team', urn: 'hrn:app:x:team', organizationId: 'org-1' },
    reportsToWorkerId: null, reportsToRetired: false, reportsTo: null,
    ...over,
  };
}

const mounted: Mounted<Record<string, unknown>>[] = [];
beforeEach(() => {
  resetNavigationGuards();
  setStubPage('https://example.test/app/workers/w-a', { id: 'w-a' });
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function mount(w: ReturnType<typeof worker>) {
  const m = mountComponent(Page as never, {
    data: {
      worker: w,

      initialTab: 'profile', initialView: null,
      workerSessions: [], sessionsTruncated: false, worklog: [], worklogTotal: 0,
    },
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m.target;
}

function reportsToRow(target: HTMLElement): HTMLElement | null {
  const dt = [...target.querySelectorAll('dt')].find((d) => d.textContent?.trim() === 'Reports to');
  return (dt?.parentElement as HTMLElement | undefined) ?? null;
}

describe('worker page: Reports to (#1067)', () => {
  it('links to the worker it reports to, with that worker’s URN', async () => {
    const target = await mount(worker({
      reportsToWorkerId: 'w-ada',
      reportsTo: { id: 'w-ada', name: 'Ada', urn: 'hrn:worker:hadronmemory.com:team:ada', retiredAt: null },
    }));
    const row = reportsToRow(target);
    expect(row).not.toBeNull();
    const link = row!.querySelector<HTMLAnchorElement>('a[href="/app/workers/w-ada"]');
    expect(link?.textContent?.trim()).toBe('Ada');
    expect(row!.textContent?.replace(/\s+/g, '')).toContain('hrn:worker:hadronmemory.com:team:ada');
    expect(row!.textContent).not.toContain('retired');
  });

  it('flags a retired target rather than hiding the stale claim', async () => {
    const target = await mount(worker({
      reportsToWorkerId: 'w-old', reportsToRetired: true,
      reportsTo: { id: 'w-old', name: 'Old', urn: null, retiredAt: '2026-09-01T00:00:00.000Z' },
    }));
    const row = reportsToRow(target)!;
    expect(row.querySelector('a[href="/app/workers/w-old"]')?.textContent?.trim()).toBe('Old');
    expect(row.textContent).toContain('(retired)');
  });

  it('renders no line at all when unset or masked', async () => {
    const target = await mount(worker({}));
    expect(reportsToRow(target)).toBeNull();
    expect(target.textContent).not.toContain('Reports to');
  });
});
