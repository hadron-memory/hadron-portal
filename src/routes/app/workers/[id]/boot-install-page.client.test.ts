import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { updateSignatureSchema } from './schema';
import Page from './+page.svelte';

const VIEWER = 'u1';

function worker(id: string, heldByUserId: string | null) {
  return {
    hasLiveSession: false,
    id, appId: 'app-1', agentId: 'agent-1', name: `Worker ${id}`, slug: id, urn: `hrn:worker:a.com:team:${id}`,
    role: 'engineer', prompt: 'P', memoryId: null, retiredAt: null,
    heldByUserId, heldAt: heldByUserId ? '2026-10-21T00:00:00Z' : null, createdAt: '1789430400000',
    agent: { id: 'agent-1', name: 'Engineer', urn: 'hrn:agent:a.com:engineer', },
    app: { id: 'app-1', name: 'Team', urn: 'hrn:app:a.com:team', organizationId: 'org-1' },
  };
}

async function dataFor(w: ReturnType<typeof worker>, canManageWorkerApp: boolean | null) {
  return {
    worker: w,
    user: { id: VIEWER },

    signatureForm: await superValidate({}, zod4(updateSignatureSchema), { errors: false }),
    initialTab: 'briefing', initialView: null,
    workerSessions: [], sessionsTruncated: false, worklog: [], worklogTotal: 0,
    bootPointer: { ok: true, ref: null, deleted: null },
    canManageWorkerApp,
    bootPointerKey: w.id,
  };
}

const mounted: Array<Mounted<Record<string, unknown>>> = [];
beforeEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationGuards();
  setStubPage('https://example.test/app/workers/w-a?tab=briefing', { id: 'w-a' });
});

async function mountWorker(props: Record<string, unknown>) {
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}
const pointerForm = (root: HTMLElement) => root.querySelector<HTMLFormElement>('form[action*="/setBootPrompt"]');
const input = (root: HTMLElement) => root.querySelector<HTMLInputElement>('#worker-boot-pointer-node-ref');

afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.unstubAllGlobals(); });
describe('portal#1666 real worker page', () => {
  it('offers the App manager compile and empty source in Boot briefing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (!url.includes('/app/boot-prompt?') || !url.includes('worker=w-a')) throw new Error('unexpected endpoint');
      return { ok: true, json: async () => ({ key: 'workerCompile:w-a:app-1:agent-1', compiled: null, source: null, canStart: true, pointerMatches: null }) };
    }));
    const root = await mountWorker({ data: await dataFor(worker('w-a', null), true), form: null });
    await tick(8);
    expect(root.querySelector('[data-install-compile]')).not.toBeNull();
    expect(root.textContent).toContain('Update the prompt');
    expect(root.textContent).toContain('Start an empty source for this worker');
  });
});
