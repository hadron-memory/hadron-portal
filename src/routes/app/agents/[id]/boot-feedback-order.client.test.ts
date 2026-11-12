import { afterEach, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { setStubPage, resetStubPage } from '$lib/test/stubs/app-stores';
import Source from './BootPromptSource.svelte';
import { bootCompileSchema, bootApproveSchema } from './schema';
let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); vi.unstubAllGlobals(); resetStubPage(); });
it('keeps Agent compile and approval feedback before the provenance table', async () => {
  setStubPage('https://example.test/app/agents/a?tab=boot-prompt', { id: 'a' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ page: { items: [], total: 0, offset: 0, hasMore: false, pruned: false } }) }));
  const compileInitial = await superValidate({}, zod4(bootCompileSchema), { id: 'compile', errors: false });
  compileInitial.message = { type: 'success', text: 'Built revision 3.' };
  const approveInitial = await superValidate({ nodeId: 'c', revision: 3 }, zod4(bootApproveSchema), { id: 'approve', errors: false });
  approveInitial.message = { type: 'success', text: 'Revision approved.' };
  const compiled = { id: 'c', urn: 'hrn:node:example.com:sys:boot:compiled', memoryId: 'sys', revision: 3, content: 'compiled', pending: true, approvedRevision: null, lint: null };
  const m = mountComponent(Source, { agentId: 'a', source: { id: 's', urn: 'hrn:node:example.com:sys:boot:source', memoryId: 'sys', revision: 1, content: 'source', approval: { state: 'NOT_APPROVED', tone: 'neutral', approval: null, canApprove: true } }, compiled, compileInitial, approveInitial, canManage: true }); cleanup = m.unmount;
  await tick(5); flushSync();
  await vi.waitFor(() => expect(m.target.querySelector('section[aria-label="Built from"]')).not.toBeNull());
  const provenance = m.target.querySelector('section[aria-label="Built from"]')!;
  for (const text of ['Built revision 3.', 'Revision approved.']) {
    const notice = [...m.target.querySelectorAll('[role=status]')].find(n => n.textContent === text)!;
    expect(notice).toBeTruthy();
    expect(notice.compareDocumentPosition(provenance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});
