/**
 * #942 — the Channels page, mounted (superforms needs the client lane's `$app` aliases). Review fixes on #944: a Channel with no
 * flat address shows its id (the loc is memory-relative, never an address),
 * and every chrome string goes through t().
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { submitEnhanced } from '$lib/test/stubs/app-forms';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
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

  it('a POST-only row counts nothing as new; search finds rows by the attendee URN shown', async () => {
    const r = (id: string, role: string, attendeeUrn: string | null, attendeeWorkerId: string | null) => ({
      id, ownerType: 'APP', ownerId: 'app-1', appId: 'app-1', organizationId: null, channelId: 'ch-team',
      channel: { id: 'ch-team', name: 'Team chat', loc: 'chats:team', chatRootUrn: 'hrn:node:acme.com:team-shared:chats:team' },
      attendeeWorkerId, attendeeAgentId: null, attendeeUrn, role, mentionOnly: true, installDefault: false, description: null, createdAt: '',
    });
    const attendees = [
      { id: 'w-ada', name: 'Ada', urn: 'hrn:worker:acme.com:team:ada', kind: 'worker', role: null, retired: false },
      { id: 'w-bo', name: 'Bo', urn: 'hrn:worker:acme.com:team:bo', kind: 'worker', role: null, retired: false },
    ];
    const { target } = await mountPage([channel()], {
      attendees,
      appRows: [r('re-ada', 'POST', 'hrn:worker:acme.com:team:ada', 'w-ada'), r('re-bo', 'WATCH', 'hrn:worker:acme.com:team:bo', 'w-bo')],
    });
    const regTable = [...target.querySelectorAll('table')].find((tb) => tb.textContent?.includes('Takes part as'))!;
    const adaRow = [...regTable.querySelectorAll('tr')].find((tr) => tr.textContent?.includes('Ada'))!;
    expect(adaRow.textContent).toContain('Nothing (post only)');
    expect(adaRow.textContent).not.toContain('Only when mentioned');

    // The register table's own search box (the Channels table's is "Search channels…").
    const search = target.querySelector<HTMLInputElement>('input[aria-label="Search…"]')!;
    search.value = 'hrn:worker:acme.com:team:bo';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(3);
    expect(regTable.textContent).toContain('Bo');
    expect(regTable.textContent).not.toContain('Ada');
  });

  it('the add form shows the chosen Channel’s URN under its picker', async () => {
    const { target } = await mountPage([channel()]);
    const pick = target.querySelector<HTMLSelectElement>('select[name="channelId"]')!;
    pick.value = 'ch-team';
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(3);
    expect(pick.parentElement!.innerHTML).toContain('hrn:node:acme.com:team-shared:chats:team');
  });

  it('"Show for" shows the chosen attendee’s URN', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ rows: [] }) }) as unknown as Response));
    try {
      const attendees = [{ id: 'ag-1', name: 'Coordinator', urn: 'hrn:agent:acme.com:coordinator', kind: 'agent', retired: false }];
      const { target } = await mountPage([channel()], { attendees });
      const pick = [...target.querySelectorAll<HTMLSelectElement>('select')].find((s) => s.options[0]?.textContent?.includes('Pick a worker or agent'))!;
      pick.value = 'ag-1';
      pick.dispatchEvent(new Event('change', { bubbles: true }));
      await tick(5);
      expect(pick.parentElement!.innerHTML).toContain('hrn:agent:acme.com:coordinator');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a read-only caller still sees the target memory’s URN in the create panel', async () => {
    const { target } = await mountPage([channel()], { canWrite: { 'mem-shared': false } });
    const panel = [...target.querySelectorAll('h2')].find((h) => h.textContent?.includes('New channel'))!.parentElement!;
    expect(panel.textContent).toContain('needs write access');
    expect(panel.innerHTML).toContain('hrn:mem:acme.com:team-shared');
  });

  it('Last message is formatted with a pinned locale', async () => {
    const body = await html([channel({ lastMessageAt: '2026-09-26T10:00:00Z' })]);
    expect(body).toMatch(/Sep 26, 2026/);
  });

  it('a picked Channel with no flat address shows its id under the picker', async () => {
    const { target } = await mountPage([channel({ id: 'ch-legacy', chatRootUrn: null })]);
    const pick = target.querySelector<HTMLSelectElement>('select[name="channelId"]')!;
    pick.value = 'ch-legacy';
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(3);
    expect(pick.parentElement!.textContent).toContain('ch-legacy');
  });

  it('“Takes part as” can’t be hidden: it holds the edit form the Save button submits', async () => {
    const appRows = [{
      id: 're-1', ownerType: 'APP', ownerId: 'app-1', appId: 'app-1', organizationId: null, channelId: 'ch-team',
      channel: { id: 'ch-team', name: 'Team chat', loc: 'chats:team', chatRootUrn: null }, attendeeWorkerId: null, attendeeAgentId: null,
      attendeeUrn: null, role: 'BOTH', mentionOnly: false, installDefault: false, description: null, createdAt: '',
    }];
    const { target } = await mountPage([channel()], { appRows });
    const regTable = [...target.querySelectorAll('table')].find((tb) => tb.querySelector('form[action="?/removeAttendance"], button') && tb.textContent?.includes('Set by'))!;
    let grid: HTMLElement = regTable;
    while (!grid.querySelector('details')) grid = grid.parentElement!;
    // The Columns menu lists only hideable columns (its <details> is in the DOM while closed).
    const toggles = [...grid.querySelectorAll('details label')].map((l) => l.textContent?.trim());
    expect(toggles).toContain('Set by'); // the menu is really there
    expect(toggles).not.toContain('Takes part as');
  });

  it('effective search matches the Channel URN shown under the name', async () => {
    const rows = [
      { id: 'e1', channel: 'team', channelUrn: 'hrn:node:acme.com:a:chats:team', mode: 'Watch', counts: 'All messages', because: 'Their own row', readUpTo: 'x', note: '' },
      { id: 'e2', channel: 'team', channelUrn: 'hrn:node:acme.com:b:chats:team', mode: 'Post', counts: 'Nothing (post only)', because: 'Their own row', readUpTo: 'y', note: '' },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ rows, loadedAt: '2026-09-26T00:00:00Z' }) }) as unknown as Response));
    try {
      const attendees = [{ id: 'w-ada', name: 'Ada', urn: null, kind: 'worker', role: null, retired: false }];
      const { target } = await mountPage([channel()], { attendees });
      const pick = [...target.querySelectorAll<HTMLSelectElement>('select')].find((s) => s.options[0]?.textContent?.includes('Pick a worker or agent'))!;
      pick.value = 'w-ada';
      pick.dispatchEvent(new Event('change', { bubbles: true }));
      await tick(6);
      const effTable = [...target.querySelectorAll('table')].find((tb) => tb.textContent?.includes('Because of'))!;
      let grid: HTMLElement = effTable;
      while (!grid.querySelector('input[aria-label]')) grid = grid.parentElement!;
      const search = grid.querySelector<HTMLInputElement>('input[aria-label]')!;
      search.value = 'hrn:node:acme.com:b';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await tick(3);
      expect(effTable.textContent).toContain('Nothing (post only)');
      expect(effTable.textContent).not.toContain('All messages');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('with no readable shared memory, the create panel says unavailable, never "has none"', async () => {
    const { target } = await mountPage([channel()], { app: { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: 'org-1', defaultChannel: null, sharedMemory: null } });
    const panel = [...target.querySelectorAll('h2')].find((h) => h.textContent?.includes('New channel'))!.parentElement!;
    expect(panel.textContent).toContain('isn’t available to you');
    expect(panel.textContent).not.toMatch(/has no shared memory/);
  });

  it('a register row for a Channel with no flat address shows, and searches, its id', async () => {
    const row = (id: string, channelId: string) => ({
      id, ownerType: 'APP', ownerId: 'app-1', appId: 'app-1', organizationId: null, channelId,
      channel: { id: channelId, name: 'legacy', loc: 'chats:legacy', chatRootUrn: null }, attendeeWorkerId: null, attendeeAgentId: null,
      attendeeUrn: null, role: 'BOTH', mentionOnly: false, installDefault: false, description: null, createdAt: '',
    });
    const { target } = await mountPage([channel()], { appRows: [row('re-1', 'ch-leg-1'), row('re-2', 'ch-leg-2')] });
    const regTable = [...target.querySelectorAll('table')].find((tb) => tb.textContent?.includes('Set by'))!;
    // The Channel cell shows the name, and the id as its own address line.
    const ids = [...regTable.querySelectorAll('tbody tr td:first-child .font-mono')].map((e) => e.textContent);
    expect(ids).toEqual(['ch-leg-1', 'ch-leg-2']);
    const search = target.querySelector<HTMLInputElement>('input[aria-label="Search…"]')!;
    search.value = 'ch-leg-2';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(3);
    const after = [...regTable.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')?.textContent ?? '');
    expect(after.some((c) => c.includes('ch-leg-2'))).toBe(true);
    expect(after.some((c) => c.includes('ch-leg-1'))).toBe(false);
  });

  it('navigating to another App clears the effective view, and a late answer for the first App is dropped', async () => {
    let release!: (v: unknown) => void;
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((u: string) => {
      calls.push(u);
      // App A's answer is held until after the navigation.
      return new Promise((resolve) => {
        release = resolve;
      });
    }));
    try {
      const attendees = [{ id: 'ag-1', name: 'Coordinator', urn: null, kind: 'agent', retired: false }];
      const first = await mountPage([channel()], { attendees });
      const props = reactiveProps({ ...(first.props as Record<string, unknown>) });
      first.unmount();
      const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
      mounted.push(m);
      await tick(3);
      const pick = () => [...m.target.querySelectorAll<HTMLSelectElement>('select')].find((s) => s.options[0]?.textContent?.includes('Pick a worker or agent'))!;
      pick().value = 'ag-1';
      pick().dispatchEvent(new Event('change', { bubbles: true }));
      await tick(3);
      expect(calls).toHaveLength(1);

      // Navigate: same component, App B's data (same Agent installed there).
      const data = props.data as Record<string, unknown>;
      props.data = { ...data, app: { ...(data.app as object), id: 'app-2', name: 'Other team' } };
      await tick(3);
      expect(pick().value).toBe('');

      // A's answer arrives late: it must not fill B's panel.
      release({ ok: true, json: async () => ({ rows: [{ id: 'e1', channel: 'from-A', channelUrn: null, mode: 'Watch', counts: 'All messages', because: 'x', readUpTo: 'x', note: '' }], loadedAt: 'x' }) });
      await tick(8);
      expect(m.target.textContent).not.toContain('from-A');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('names the App it manages with its URN', async () => {
    const { target } = await mountPage([channel()]);
    const h1 = target.querySelector('h1')!;
    expect(h1.parentElement!.innerHTML).toContain('hrn:app:acme.com:team');
  });
});
