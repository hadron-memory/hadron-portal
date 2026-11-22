/** portal#2454 — the add-conversation result region goes out of flow with `idle:absolute`. */
import { afterEach, beforeEach, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { expectIdleAbsoluteRegion } from '$lib/test/idleAbsoluteRegion';
import Page from './+page.svelte';
import { addConversationSchema, addEdgeSchema } from './schema';

let m: Mounted<Record<string, unknown>> | undefined;
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { vi.unstubAllGlobals(); m?.unmount(); m = undefined; });

it('the idle region carries idle:absolute, not empty:absolute', async () => {
  const data = {
    agent: { id: 'ag-1', name: 'Agent', urn: 'hrn:agent:acme.com:ag-1' },
    org: { id: 'org-1', name: 'Acme', urn: 'hrn:org:acme.com' },
    systemMemoryId: 'mem-1', prompts: [], systemNodes: [],
    addConversationForm: await superValidate({ systemMemoryId: 'mem-1', name: '' }, zod4(addConversationSchema), { errors: false }),
    addEdgeForm: await superValidate(zod4(addEdgeSchema), { errors: false }),
    addStageForms: {}, promptForms: {}, edgeForms: {}, stageExtractionForms: {}, conversationGoalForms: {}, conversationStartForms: {},
  };
  m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
  await tick(3);
  await expectIdleAbsoluteRegion(m.target);
});
