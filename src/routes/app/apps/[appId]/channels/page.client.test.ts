/**
 * #942 — the Channels page, mounted (superforms needs the client lane's `$app` aliases). Review fixes on #944: a Channel with no
 * flat address shows its id (the loc is memory-relative, never an address),
 * and every chrome string goes through t().
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import Page from './+page.svelte';
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
    lastSeq: 12, lastMessageAt: null, createdAt: '2026-09-01T00:00:00Z', memory: SHARED, ...over,
  };
}

async function mountPage(channels: unknown[], extra: Record<string, unknown> = {}) {
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
  const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  return m;
}
async function html(channels: unknown[]) {
  return (await mountPage(channels)).target.innerHTML;
}

describe('Channels page', () => {
  it('a Channel with a flat address shows it as a URN chip', async () => {
    expect(await html([channel()])).toContain('hrn:node:acme.com:team-shared:chats:team');
  });

  it('with no chatRootUrn it shows the id, never the memory-relative loc', async () => {
    const body = await html([channel({ id: 'ch-legacy', chatRootUrn: null, loc: 'chats:legacy' })]);
    expect(body).toContain('ch-legacy');
    expect(body).not.toMatch(/>chats:legacy</);
  });

  it('that id is also what search matches in the Address column', async () => {
    const { target } = await mountPage([
      channel(),
      channel({ id: 'ch-legacy', name: 'Old', chatRootUrn: null, loc: 'chats:legacy' }),
    ]);
    const search = target.querySelector<HTMLInputElement>('input[aria-label="Search channels…"]')!;
    search.value = 'ch-legacy';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(3);
    expect(target.querySelector('table')!.textContent).toContain('Old');
  });

  it('search finds a Channel by the description shown under its name', async () => {
    const { target } = await mountPage([
      channel(),
      channel({ id: 'ch-rel', name: 'Release', loc: 'chats:release', chatRootUrn: 'hrn:node:acme.com:team-shared:chats:release', description: 'Ship-day coordination' }),
    ]);
    const search = target.querySelector<HTMLInputElement>('input[aria-label="Search channels…"]')!;
    search.value = 'ship-day';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(3);
    const text = target.querySelector('table')!.textContent!;
    expect(text).toContain('Release');
    expect(text).not.toContain('Team chat');
  });

  it('the attendee picker offers active Workers only, and shows the chosen one’s URN', async () => {
    const attendees = [
      { id: 'w-ada', name: 'Ada', urn: 'hrn:worker:acme.com:team:ada', kind: 'worker', role: 'coordinator', retired: false },
      { id: 'w-old', name: 'Olaf', urn: 'hrn:worker:acme.com:team:olaf', kind: 'worker', role: null, retired: true },
    ];
    const { target } = await mountPage([channel()], { attendees });
    const picker = target.querySelector<HTMLSelectElement>('select[name="attendee"]')!;
    expect([...picker.options].map((o) => o.value)).toEqual(['', 'w-ada']);
    expect(target.innerHTML).not.toContain('hrn:worker:acme.com:team:ada');
    picker.value = 'w-ada';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(3);
    expect(picker.parentElement!.innerHTML).toContain('hrn:worker:acme.com:team:ada');
  });

  it('a register row naming a retired Worker keeps its name', async () => {
    const attendees = [{ id: 'w-old', name: 'Olaf', urn: 'hrn:worker:acme.com:team:olaf', kind: 'worker', role: null, retired: true }];
    const appRows = [{
      id: 're-1', ownerType: 'APP', ownerId: 'app-1', appId: 'app-1', organizationId: null, channelId: 'ch-team',
      channel: { id: 'ch-team', name: 'Team chat', loc: 'chats:team', chatRootUrn: null }, attendeeWorkerId: 'w-old', attendeeAgentId: null,
      attendeeUrn: 'hrn:worker:acme.com:team:olaf', role: 'BOTH', mentionOnly: false, installDefault: false, description: null, createdAt: '',
    }];
    const { target } = await mountPage([channel()], { attendees, appRows });
    expect(target.textContent).toContain('Olaf');
  });

  it('"Show for" loads the attendee just picked, not the previous one (Codex P1 on #946, measured)', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(u);
      return { ok: true, json: async () => ({ rows: [] }) } as Response;
    }));
    try {
      const attendees = [
        { id: 'w-ada', name: 'Ada', urn: null, kind: 'worker', role: null, retired: false },
        { id: 'ag-1', name: 'Coordinator', urn: null, kind: 'agent', retired: false },
      ];
      const { target } = await mountPage([channel()], { attendees });
      const pick = [...target.querySelectorAll<HTMLSelectElement>('select')].find((s) =>
        s.options[0]?.textContent?.includes('Pick a worker or agent'),
      )!;
      for (const id of ['w-ada', 'ag-1']) {
        pick.value = id;
        pick.dispatchEvent(new Event('change', { bubbles: true }));
        await tick(5);
      }
      expect(urls.map((u) => new URL(u, 'http://x').searchParams.get('attendee'))).toEqual(['w-ada', 'ag-1']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
