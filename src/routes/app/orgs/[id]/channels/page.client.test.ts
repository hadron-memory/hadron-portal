/**
 * #942 — the organization's Channels page, mounted (superforms needs the client
 * lane's `$app` aliases). The register is the shared RegisterPanel, here with
 * the organization as owner.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { submitEnhanced } from '$lib/test/stubs/app-forms';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import Page from './+page.svelte';
import { rowMenuItems } from '$lib/test/rowMenu';
import { addAttendanceSchema, editAttendanceSchema, removeAttendanceSchema } from '$lib/register/schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const MEM = { id: 'mem-org', urn: 'hrn:mem:acme.com:shared', name: 'Acme shared' };
function channel(over: Record<string, unknown> = {}) {
  return {
    id: 'ch-1', name: 'All hands', description: null, kind: 'CHAT', loc: 'chats:all-hands',
    chatRootUrn: 'hrn:node:acme.com:shared:chats:all-hands', chatRootNodeId: 'root-1',
    lastSeq: 3, lastMessageAt: null, createdAt: '', memoryId: 'mem-org', memory: MEM, ...over,
  };
}
function row(over: Record<string, unknown> = {}) {
  return {
    id: 're-1', ownerType: 'ORGANIZATION', ownerId: 'org-1', appId: null, organizationId: 'org-1', channelId: 'ch-1',
    channel: { id: 'ch-1', name: 'All hands', loc: 'chats:all-hands', chatRootUrn: 'hrn:node:acme.com:shared:chats:all-hands' },
    attendeeWorkerId: null, attendeeAgentId: null, attendeeUrn: null, role: 'BOTH', mentionOnly: false, installDefault: false,
    description: null, createdAt: '', ...over,
  };
}

async function pageData(extra: Record<string, unknown> = {}) {
  return {
    org: { id: 'org-1', name: 'Acme', urn: 'hrn:org:acme.com' },
    channels: [channel()],
    orgRows: [row()],
    attendees: [{ id: 'w-1', name: 'Ada (Team A)', urn: 'hrn:worker:acme.com:a:ada', kind: 'worker', role: null, retired: false, appUrn: 'hrn:app:acme.com:a' }],
    registerLoadFailed: false,
    canManageRegister: true,
    rosterUnreadApps: 0,
    rosterFailed: false,
    addAttendanceForm: await superValidate(zod4(addAttendanceSchema), { errors: false }),
    editAttendanceForm: await superValidate(zod4(editAttendanceSchema), { errors: false }),
    removeAttendanceForm: await superValidate(zod4(removeAttendanceSchema), { errors: false }),
    ...extra,
  };
}
async function mountPage(extra: Record<string, unknown> = {}) {
  const data = await pageData(extra);
  const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  return m.target;
}
// #1020: row actions (Edit / Remove) live in each row's ⋯ menu.
const buttons = (root: HTMLElement, text: string) => rowMenuItems(root, text);

describe('the organization Channels page', () => {
  it('lists the org’s Channels with their addresses and memories', async () => {
    const root = await mountPage();
    expect(root.innerHTML).toContain('hrn:node:acme.com:shared:chats:all-hands');
    expect(root.innerHTML).toContain('hrn:mem:acme.com:shared');
  });

  it('a contributor can edit and remove the org’s rows, and add with “Everyone in the organization”', async () => {
    const root = await mountPage();
    expect(buttons(root, 'Edit')).toHaveLength(1);
    expect(buttons(root, 'Remove')).toHaveLength(1);
    const who = root.querySelector<HTMLSelectElement>('select[name="attendee"]')!;
    expect(who.options[0].textContent).toBe('Everyone in the organization');
    expect([...who.options].map((o) => o.textContent)).toContain('Ada (Team A)');
  });

  it('a READER sees the rows read-only, no add form, and why', async () => {
    const root = await mountPage({ canManageRegister: false });
    expect(buttons(root, 'Edit')).toHaveLength(0);
    expect(root.querySelector('form[action="?/addAttendance"]')).toBeNull();
    expect(root.textContent).toContain('needs contributor rights in this organization');
  });

  it('an unknown standing (null) still offers the controls: the server decides', async () => {
    const root = await mountPage({ canManageRegister: null });
    expect(buttons(root, 'Edit')).toHaveLength(1);
    expect(root.querySelector('form[action="?/addAttendance"]')).not.toBeNull();
  });

  it('a row naming a Channel the viewer can’t read stays concealed', async () => {
    const root = await mountPage({ orgRows: [row({ channel: null, channelId: 'ch-secret' })] });
    expect(root.textContent).toContain('A channel you can’t read');
    expect(root.innerHTML).not.toContain('ch-secret');
  });

  it('renders a Channel whose host memory record is concealed (#2509): no crash, link by memoryId, host withheld', async () => {
    const root = await mountPage({ channels: [channel({ memory: null })] });
    // The channel itself is still listed…
    expect(root.textContent).toContain('All hands');
    // …its chat root stays reachable through the non-null memoryId…
    expect(root.querySelector(`a[href="/app/memories/mem-org/nodes/root-1"]`)).not.toBeNull();
    // …and the concealed host renders as withheld prose, never an empty URN chip.
    expect(root.textContent).toContain('Memory not shown');
    expect(root.innerHTML).not.toContain('hrn:mem:acme.com:shared');
  });

  it('Remove → confirm actually submits (the form store carries the ref)', async () => {
    const root = await mountPage();
    buttons(root, 'Remove')[0].click();
    await tick(3);
    const confirm = root.querySelector<HTMLFormElement>('form[action="?/removeAttendance"]')!;
    expect((await submitEnhanced(confirm)).cancelled).toBe(false);
  });

  it('a failed register read is an error, not an empty register', async () => {
    const root = await mountPage({ registerLoadFailed: true, orgRows: [] });
    expect(root.textContent).toContain('This is an error, not an empty list');
    expect(root.textContent).not.toContain('Nobody is set up to take part');
  });

  it('says when some Apps’ people couldn’t be read, and still shows the rows', async () => {
    const root = await mountPage({ rosterUnreadApps: 2 });
    expect(root.textContent).toContain('Couldn’t load the workers and agents of 2 App(s)');
    expect(root.textContent).toContain('All hands');
  });

  it('moving to another organization reseeds the forms: nothing typed for A is left on B', async () => {
    const props = reactiveProps({ data: await pageData(), form: null } as Record<string, unknown>);
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(3);
    const note = () => m.target.querySelector<HTMLInputElement>('form[action="?/addAttendance"] input[name="description"]')!;
    note().value = 'typed for Acme';
    note().dispatchEvent(new Event('input', { bubbles: true }));
    buttons(m.target, 'Edit')[0].click();
    await tick(3);
    expect(note().value).toBe('typed for Acme');
    expect(m.target.querySelector('form[action="?/editAttendance"]')).not.toBeNull();

    // Same component, org B.
    props.data = await pageData({ org: { id: 'org-2', name: 'Globex', urn: 'hrn:org:globex.com' }, orgRows: [row({ id: 're-b', organizationId: 'org-2', ownerId: 'org-2' })] });
    await tick(5);
    expect(note().value).toBe('');
    expect(m.target.querySelector('form[action="?/editAttendance"]')).toBeNull();
  });

  it('the picked Worker shows its App’s URN as well as its own', async () => {
    const root = await mountPage();
    const who = root.querySelector<HTMLSelectElement>('select[name="attendee"]')!;
    who.value = 'w-1';
    who.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(3);
    expect(who.parentElement!.innerHTML).toContain('hrn:worker:acme.com:a:ada');
    expect(who.parentElement!.innerHTML).toContain('hrn:app:acme.com:a');
  });

  it('says when the org’s workers and agents couldn’t be read at all, and still shows the rows', async () => {
    const root = await mountPage({ rosterFailed: true, attendees: [] });
    expect(root.textContent).toContain('Couldn’t load this organization’s workers and agents');
    expect(root.textContent).toContain('All hands');
  });
});
