/**
 * portal#2344 / #2377: the effective-view loading line is announced by a region that exists
 * before the read, holds the text during it and is the same element after.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { submitEnhanced } from '$lib/test/stubs/app-forms';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import Page from './+page.svelte';
import { announcedStatusRegion, idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import {
  addAttendanceSchema,
  createChannelSchema,
  deleteChannelSchema,
  editAttendanceSchema,
  removeAttendanceSchema,
  renameChannelSchema,
} from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const SHARED = { id: 'mem-shared', urn: 'hrn:mem:acme.com:team-shared', name: 'Team — shared chats' };
function channel(over: Record<string, unknown> = {}) {
  return {
    id: 'ch-team', name: 'Team chat', description: null, kind: 'CHAT', loc: 'chats:team',
    chatRootUrn: 'hrn:node:acme.com:team-shared:chats:team', chatRootNodeId: 'root-1',
    lastSeq: 12, lastMessageAt: null, createdAt: '2026-09-01T00:00:00Z', memoryId: 'mem-shared', memory: SHARED, ...over,
  };
}

async function mountPage(channels: unknown[], extra: Record<string, unknown> = {}, actionData: unknown = null) {
  const data = {
    appRows: [], orgRows: [], attendees: [], canManageRegister: true, registerLoadFailed: false,
    addAttendanceForm: await superValidate(zod4(addAttendanceSchema), { errors: false }),
    editAttendanceForm: await superValidate(zod4(editAttendanceSchema), { errors: false }),
    removeAttendanceForm: await superValidate(zod4(removeAttendanceSchema), { errors: false }),
    app: { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: 'org-1', defaultChannel: { id: 'ch-team' }, sharedMemory: SHARED },
    channels, total: channels.length, defaultChannelId: 'ch-team', canWrite: { 'mem-shared': true },
    createForm: await superValidate(zod4(createChannelSchema), { errors: false }),
    renameForm: await superValidate(zod4(renameChannelSchema), { errors: false }),
    deleteForm: await superValidate(zod4(deleteChannelSchema), { errors: false }),
    ...extra,
  };
  const m = mountComponent(Page as never, { data, form: actionData } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  return m;
}
async function html(channels: unknown[]) {
  return (await mountPage(channels)).target.innerHTML;
}


describe('portal#2344: the effective-view loading line is a persistent live region', () => {
  it('one region exists empty, holds Loading… during the read and is the same element after', async () => {
    let release!: (v: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { release = resolve; })));
    try {
      const attendees = [{ id: 'ag-1', name: 'Coordinator', urn: null, kind: 'agent', retired: false }];
      const m = await mountPage([channel()], { attendees });
      const idle = idleStatusRegions(m.target);
      expect(idle.length).toBeGreaterThan(0);
      expect(announcedStatusRegion(m.target)).toBeNull();

      const pick = [...m.target.querySelectorAll<HTMLSelectElement>('select')].find((s) => s.options[0]?.textContent?.includes('Pick a worker or agent'))!;
      pick.value = 'ag-1';
      pick.dispatchEvent(new Event('change', { bubbles: true }));
      await tick(3);
      const during = announcedStatusRegion(m.target);
      expect(during?.textContent).toContain('Loading');
      expect(idle).toContain(during);

      release({ ok: true, json: async () => ({ rows: [], loadedAt: 'x' }) });
      await tick(8);
      expect(announcedStatusRegion(m.target)?.textContent ?? '').not.toContain('Loading');
      expect(during!.isConnected).toBe(true);
      expect(during!.textContent?.trim()).toBe('');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
