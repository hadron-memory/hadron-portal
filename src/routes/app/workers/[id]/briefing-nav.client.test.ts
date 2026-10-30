import { beforeEach, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { updateSignatureSchema } from './schema';
import Page from './+page.svelte';

function worker(id: string, extraText: string | null) {
  return {
    hasLiveSession: false,
    id,
    appId: 'app-1',
    agentId: 'agent-1',
    name: id === 'w-a' ? 'Ada' : 'Dara',
    slug: id === 'w-a' ? 'ada' : 'dara',
    urn: `hrn:worker:hadronmemory.com:team:${id}`,
    role: 'engineer',
    prompt: `BOUND TEMPLATE FOR ${id}${extraText ? `\n\n${extraText}` : ''}`,
    memoryId: null,
    retiredAt: null,
    heldByUserId: null,
    heldAt: null,
    createdAt: '1789430400000',
    agent: { id: 'agent-1', name: 'Engineer', urn: 'hrn:agent:x:engineer' },
    app: { id: 'app-1', name: 'Team', urn: 'hrn:app:x:team', organizationId: 'org-1' },
  };
}

async function dataFor(w: ReturnType<typeof worker>) {
  return {
    worker: w,
    // portal#1142 P4: the Briefing tab now also mounts the signature section,
    // which the loader always seeds. A masked worker seeds it empty.
    signatureForm: await superValidate({}, zod4(updateSignatureSchema), { errors: false }),
    initialTab: 'briefing',
    initialView: 'rendered',
    workerSessions: [],
    sessionsTruncated: false,
    worklog: [],
    worklogTotal: 0,
  };
}


beforeEach(() => {
  resetNavigationGuards();
  setStubPage('http://localhost/app/workers/w-a?tab=briefing', { id: 'w-a' });
});
it('#1379 briefing source is read-only and never offers a retired override editor', async () => {
  const mounted = mountComponent(Page, { data: await dataFor(worker('w-a', null)), form: null } as never);
  const { target } = mounted;
  try {
    flushSync();
    const sourceButton = [...target.querySelectorAll('button')].find(button => button.textContent === 'Source');
    expect(sourceButton).toBeDefined();
    expect(sourceButton!.getAttribute('aria-pressed')).toBe('false');
    sourceButton!.click();
    flushSync();
    expect(sourceButton!.getAttribute('aria-pressed')).toBe('true');
    const source = [...target.querySelectorAll('pre')].find(pre => pre.textContent === 'BOUND TEMPLATE FOR w-a');
    expect(source).toBeDefined();
    expect(source!.isContentEditable).not.toBe(true);
    expect(target.querySelector('[name="promptOverride"]')).toBeNull();
    expect(target.querySelector('form[action*="updateBriefing"]')).toBeNull();
    expect(source!.querySelector('textarea, input, [contenteditable="true"]')).toBeNull();
  } finally { mounted.unmount(); }
});
