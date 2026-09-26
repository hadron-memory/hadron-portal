/**
 * #942 — the Channels page, mounted (superforms needs the client lane's `$app` aliases). Review fixes on #944: a Channel with no
 * flat address shows its id (the loc is memory-relative, never an address),
 * and every chrome string goes through t().
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { submitEnhanced } from '$lib/test/stubs/app-forms';
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

  it('Delete → confirm actually submits: the form’s own ref is set, not just a hidden input (Chip, #2186)', async () => {
    const { target } = await mountPage([channel(), channel({ id: 'ch-x', name: 'Other', loc: 'chats:x', chatRootUrn: 'hrn:node:acme.com:team-shared:chats:x' })]);
    const del = [...target.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Delete');
    del[1].click();
    await tick(3);
    const confirm = target.querySelector<HTMLFormElement>('form[action="?/deleteChannel"]')!;
    const { cancelled } = await submitEnhanced(confirm);
    expect(cancelled).toBe(false);
  });

  it('Remove → confirm on a register row actually submits (Chip, #2185)', async () => {
    const appRows = [{
      id: 're-1', ownerType: 'APP', ownerId: 'app-1', appId: 'app-1', organizationId: null, channelId: 'ch-team',
      channel: { id: 'ch-team', name: 'Team chat', loc: 'chats:team', chatRootUrn: null }, attendeeWorkerId: null, attendeeAgentId: null,
      attendeeUrn: null, role: 'BOTH', mentionOnly: false, installDefault: false, description: null, createdAt: '',
    }];
    const { target } = await mountPage([channel()], { appRows });
    [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Remove')!.click();
    await tick(3);
    const confirm = target.querySelector<HTMLFormElement>('form[action="?/removeAttendance"]')!;
    expect((await submitEnhanced(confirm)).cancelled).toBe(false);
  });

  it('search matches the memory URN and the default’s “Team chat” badge, as shown', async () => {
    const OTHER = { id: 'mem-o', urn: 'hrn:mem:acme.com:other', name: 'Other' };
    const { target } = await mountPage([
      channel({ name: 'Renamed default' }),
      channel({ id: 'ch-x', name: 'Elsewhere', loc: 'chats:x', chatRootUrn: 'hrn:node:acme.com:other:chats:x', memory: OTHER }),
    ]);
    const search = target.querySelector<HTMLInputElement>('input[aria-label="Search channels…"]')!;
    const rowsFor = async (q: string) => {
      search.value = q;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await tick(3);
      return target.querySelector('table')!.textContent!;
    };
    let text = await rowsFor('hrn:mem:acme.com:other');
    expect(text).toContain('Elsewhere');
    expect(text).not.toContain('Renamed default');
    text = await rowsFor('team chat');
    expect(text).toContain('Renamed default');
    expect(text).not.toContain('Elsewhere');
  });

  it('the create panel names its target memory with its URN', async () => {
    const { target } = await mountPage([channel()]);
    const panel = [...target.querySelectorAll('h2')].find((h) => h.textContent?.includes('New channel'))!.parentElement!;
    expect(panel.innerHTML).toContain('hrn:mem:acme.com:team-shared');
  });
});
