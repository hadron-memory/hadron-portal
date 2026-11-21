/**
 * portal#2376 (slice 3 of #2344): the worker page's "couldn't be loaded" notes (worker sessions,
 * worklog) sit in regions that are mounted before they speak. Before/during/after: the region EXISTS
 * and is EMPTY while the read worked, holds the note when it fails, and is the SAME element when the
 * read works again. The read comes with the page data, so the pins re-supply it with the tab open.
 */
import { afterEach, beforeEach, describe, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { expectRegionLifecycle } from '$lib/test/statusRegionLifecycle';
import Page from './+page.svelte';

let mounted: Mounted<Record<string, unknown>> | undefined;
beforeEach(() => setStubPage('http://localhost/app/workers/w-a', { id: 'w-a' }));
afterEach(() => { mounted?.unmount(); mounted = undefined; });

const worker = {
  hasLiveSession: false, id: 'w-a', appId: 'app-1', agentId: 'agent-1', name: 'Ada', slug: 'ada',
  urn: 'hrn:worker:hadronmemory.com:team:w-a', role: 'engineer', prompt: 'BOUND TEMPLATE', memoryId: null,
  retiredAt: null, leaveAlone: null, leaveAloneReason: null, leaveAloneBy: null, leaveAloneAt: null,
  heldByUserId: null, heldAt: null, createdAt: '1789430400000',
  agent: { id: 'agent-1', name: 'Engineer', urn: 'hrn:agent:x:engineer' },
  app: { id: 'app-1', name: 'Team', urn: 'hrn:app:x:team', organizationId: 'org-1' },
};
const base = {
  worker, initialView: 'rendered', workerSessions: [], sessionsTruncated: false, worklog: [], worklogTotal: 0,
  canManageWorkerApp: true, impersonation: false, canChangeAgent: false, retireKey: 'w-a',
};

async function open(initialTab: 'sessions' | 'worklog') {
  const props = reactiveProps<Record<string, unknown>>({ data: { ...base, initialTab }, form: null });
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick(2);
  const set = (patch: Record<string, unknown>) => () => { props.data = { ...base, initialTab, ...patch }; };
  return { root: mounted.target, set };
}

describe('worker page: the read-failure notes are persistent status regions', () => {
  it('"The worker sessions couldn’t be loaded": empty, then text, then the same element', async () => {
    const { root, set } = await open('sessions');
    await expectRegionLifecycle(root, 'The worker sessions couldn’t be loaded', set({ workerSessions: null }), set({}), () => tick(2));
  });

  it('"The worklog couldn’t be loaded": empty, then text, then the same element', async () => {
    const { root, set } = await open('worklog');
    await expectRegionLifecycle(root, 'The worklog couldn’t be loaded', set({ worklog: null }), set({}), () => tick(2));
  });
});
