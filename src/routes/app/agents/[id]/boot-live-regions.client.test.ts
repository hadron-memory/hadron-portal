import { afterEach, describe, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage, resetStubPage } from '$lib/test/stubs/app-stores';
import { submitEnhancedWithResult, resetKitAppliedResults } from '$lib/test/stubs/app-forms';
import { emptyRegions, liveRegions, regionHolding } from '$lib/test/liveRegionPin';
import Source from './BootPromptSource.svelte';
import StartBootSource from './StartBootSource.svelte';
import { bootCompileSchema, bootApproveSchema, bootStartSchema } from './schema';

// portal#2379 (slice of portal#2344): the compile, approve and start messages are `status` on success and
// `alert` on failure. Each lands in a region that was already mounted and empty, of the right role.
let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; vi.unstubAllGlobals(); resetStubPage(); resetKitAppliedResults(); });

async function mountSource() {
  setStubPage('https://example.test/app/agents/a?tab=boot-prompt', { id: 'a' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ page: { items: [], total: 0, offset: 0, hasMore: false, pruned: false } }) }));
  const compileInitial = await superValidate({}, zod4(bootCompileSchema), { id: 'compile', errors: false });
  const approveInitial = await superValidate({ nodeId: 'c', revision: 3 }, zod4(bootApproveSchema), { id: 'approve', errors: false });
  const compiled = { id: 'c', urn: 'hrn:node:example.com:sys:boot:compiled', memoryId: 'sys', revision: 3, content: 'compiled', pending: true, approvedRevision: null, lint: null };
  const source = { id: 's', urn: 'hrn:node:example.com:sys:boot:source', memoryId: 'sys', revision: 1, content: 'source', approval: { state: 'NOT_APPROVED', tone: 'neutral', approval: null, canApprove: true } };
  mounted = mountComponent(Source as never, { agentId: 'a', source, compiled, compileInitial, approveInitial, canManage: true } as never) as Mounted<Record<string, unknown>>;
  await tick(5);
  return { root: mounted.target, compileInitial, approveInitial };
}
const form = (root: HTMLElement, action: string) => root.querySelector<HTMLFormElement>(`form[action="?/${action}"]`)!;

describe('BootPromptSource compile and approve messages', () => {
  it.each([
    ['compileBootPrompt', 'compile', 'success', 'status', 'Built revision 3.'],
    ['compileBootPrompt', 'compile', 'error', 'alert', 'Compile refused.'],
    ['approveBootPrompt', 'approve', 'success', 'status', 'Revision approved.'],
    ['approveBootPrompt', 'approve', 'error', 'alert', 'Approve refused.'],
  ] as const)('%s (%s, %s) lands in the %s region that was already mounted and empty', async (action, which, type, role, text) => {
    const { root, compileInitial, approveInitial } = await mountSource();
    const before = emptyRegions(root);
    expect(before.map((r) => r.getAttribute('role'))).toEqual(expect.arrayContaining(['status', 'alert']));
    const posted = { ...(which === 'compile' ? compileInitial : approveInitial), message: { type, text } };
    await submitEnhancedWithResult(form(root, action), { type: type === 'success' ? 'success' : 'failure', status: type === 'success' ? 200 : 400, data: { form: posted } });
    await tick(3);
    const region = regionHolding(root, text);
    expect(before).toContain(region);
    expect(region.getAttribute('role')).toBe(role);
    // The other half of the pair stays mounted and empty; the same elements are still there.
    expect(liveRegions(root).filter((r) => r !== region && r.textContent?.includes(text))).toEqual([]);
    for (const r of before) expect(r.isConnected).toBe(true);
  });
});

describe('StartBootSource message', () => {
  it.each([
    ['success', 'status', 'Source started.'],
    ['error', 'alert', 'Could not start the source.'],
  ] as const)('a %s result lands in the %s region that was already mounted and empty', async (type, role, text) => {
    const initial = await superValidate({}, zod4(bootStartSchema), { id: 'bootStart:a', errors: false });
    mounted = mountComponent(StartBootSource as never, { seeded: true, canManage: true, initial } as never) as Mounted<Record<string, unknown>>;
    await tick(3);
    const root = mounted.target;
    const before = emptyRegions(root);
    expect(before.map((r) => r.getAttribute('role'))).toEqual(expect.arrayContaining(['status', 'alert']));
    await submitEnhancedWithResult(form(root, 'startBootSource'), { type: type === 'success' ? 'success' : 'failure', status: type === 'success' ? 200 : 400, data: { form: { ...initial, message: { type, text } } } });
    await tick(3);
    const region = regionHolding(root, text);
    expect(before).toContain(region);
    expect(region.getAttribute('role')).toBe(role);
  });
});
