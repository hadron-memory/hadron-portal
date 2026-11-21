/**
 * portal#2375 — the "add conversation" result is announced by a live region that already existed,
 * empty, before the action ran. A region that is inserted already populated is not reliably announced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { announcedStatusRegion, idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import Page from './+page.svelte';
import { addConversationSchema, addEdgeSchema } from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
beforeEach(() => {
  // The canvas observes its container; jsdom has no ResizeObserver.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  while (mounted.length) mounted.pop()!.unmount();
});

describe('add conversation result (portal#2375)', () => {
  it('is announced in the status region that was already mounted, empty', async () => {
    const data = {
      agent: { id: 'ag-1', name: 'Agent', urn: 'hrn:agent:acme.com:ag-1' },
      org: { id: 'org-1', name: 'Acme', urn: 'hrn:org:acme.com' },
      systemMemoryId: 'mem-1',
      prompts: [],
      systemNodes: [],
      addConversationForm: await superValidate({ systemMemoryId: 'mem-1', name: '' }, zod4(addConversationSchema), { errors: false }),
      addEdgeForm: await superValidate(zod4(addEdgeSchema), { errors: false }),
      addStageForms: {}, promptForms: {}, edgeForms: {}, stageExtractionForms: {}, conversationGoalForms: {}, conversationStartForms: {},
    };
    const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(3);
    const root = m.target;
    const form = root.querySelector<HTMLFormElement>('form[action="?/addConversation"]')!;
    expect(form).not.toBeNull();

    const idle = idleStatusRegions(root);
    expect(idle.length).toBeGreaterThan(0);
    expect(announcedStatusRegion(root)).toBeNull();

    const result = await superValidate({ systemMemoryId: 'mem-1', name: 'Intro' }, zod4(addConversationSchema), { errors: false });
    result.message = { type: 'success', text: 'Conversation added.' };
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: { form: result } });
    flushSync();
    await tick(2);

    const announced = announcedStatusRegion(root);
    expect(announced?.textContent).toContain('Conversation added.');
    expect(idle).toContain(announced);
  });
});
