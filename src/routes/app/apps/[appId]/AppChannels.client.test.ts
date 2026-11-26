/**
 * #942 — the Channels section's own contract (the body's behaviour is in AppChannelsBody.client.test.ts): a failed read is a
 * state of the section with a retry, the forms post to the App page's actions under the section's URL, and a write reads
 * the section again through the tab endpoint instead of invalidating the page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import AppChannels from './AppChannels.svelte';
import {
  addAttendanceSchema, createChannelSchema, deleteChannelSchema, editAttendanceSchema, removeAttendanceSchema, renameChannelSchema,
} from './channels-schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = '';
  resetNavigationCalls();
  vi.unstubAllGlobals();
});

const SHARED = { id: 'mem-shared', urn: 'hrn:mem:acme.com:team-shared', name: 'Team shared' };
const channel = {
  id: 'ch-team', name: 'Team chat', description: null, kind: 'CHAT', loc: 'chats:team',
  chatRootUrn: 'hrn:node:acme.com:team-shared:chats:team', chatRootNodeId: 'root-1',
  lastSeq: 1, lastMessageAt: null, createdAt: '2026-09-01T00:00:00Z', memoryId: 'mem-shared', memory: SHARED,
};
async function okPanel(over: Record<string, unknown> = {}) {
  return {
    kind: 'ok' as const,
    appRows: [], orgRows: [], attendees: [], canManageRegister: true, registerLoadFailed: false, agentsWithheld: false,
    addAttendanceForm: await superValidate(zod4(addAttendanceSchema), { errors: false }),
    editAttendanceForm: await superValidate(zod4(editAttendanceSchema), { errors: false }),
    removeAttendanceForm: await superValidate(zod4(removeAttendanceSchema), { errors: false }),
    app: { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: 'org-1', defaultChannel: { id: 'ch-team' }, sharedMemory: SHARED },
    channels: [channel], total: 1, defaultChannelId: 'ch-team', canWrite: { 'mem-shared': true },
    createForm: await superValidate(zod4(createChannelSchema), { errors: false }),
    renameForm: await superValidate(zod4(renameChannelSchema), { errors: false }),
    deleteForm: await superValidate(zod4(deleteChannelSchema), { errors: false }),
    ...over,
  };
}
async function mountIt(panel: unknown, extra: Record<string, unknown> = {}) {
  const m = mountComponent(AppChannels as never, { appId: 'app-1', panel, form: null, ...extra } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(3);
  return m.target;
}

describe('the Channels section', () => {
  it('a failed read says so, and Try again reads the section once and shows the answer', async () => {
    const fetched: string[] = [];
    const next = await okPanel();
    vi.stubGlobal('fetch', async (url: string) => { fetched.push(url); return { ok: true, json: async () => ({ channelsPanel: next }) }; });
    const root = await mountIt({ kind: 'failed' });
    expect(root.textContent).toContain('Couldn’t load the channels.');
    [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Try again')!.click();
    await tick(40);
    expect(fetched).toEqual(['/app/apps/app-1/tab?tab=channels']);
    expect(root.textContent).not.toContain('Couldn’t load the channels.');
    expect(root.textContent).toContain('Team chat');
  });

  it('the forms post to the App page’s actions under the section’s URL, so a no-JS answer opens the section', async () => {
    const root = await mountIt(await okPanel());
    const section = '/app/apps/app-1?tab=settings&section=channels&/';
    for (const name of ['createChannel', 'addAttendance']) {
      expect(root.querySelector(`form[action="${section}${name}"]`)).not.toBeNull();
    }
  });

  // Mutant: leave superforms' own page invalidation on, and the section is not read again (the page's load does not feed it).
  it('a write reads the section again through the tab endpoint and does not invalidate the page', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { fetched.push(url); return { ok: true, json: async () => ({ channelsPanel: await okPanel() }) }; });
    const root = await mountIt(await okPanel());
    const done = await superValidate({ _kind: 'createChannel', name: 'Release', slug: 'release', description: '' }, zod4(createChannelSchema), { errors: false });
    done.message = { type: 'success', text: 'Channel created.' };
    const create = root.querySelector<HTMLFormElement>('form[action$="/createChannel"]')!;
    await submitEnhancedWithResult(create, { type: 'success', status: 200, data: { form: done } });
    await tick(6);
    expect(fetched).toEqual(['/app/apps/app-1/tab?tab=channels']);
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(false);
  });

  it('a failed re-read after a write says the list may be out of date', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const root = await mountIt(await okPanel());
    const done = await superValidate({ _kind: 'createChannel', name: 'Release', slug: 'release', description: '' }, zod4(createChannelSchema), { errors: false });
    done.message = { type: 'success', text: 'Channel created.' };
    await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('form[action$="/createChannel"]')!, { type: 'success', status: 200, data: { form: done } });
    await tick(6);
    expect(root.textContent).toContain('Couldn’t refresh.');
    expect(root.textContent).toContain('Team chat');
  });

  it('the organization’s register is linked only for an organization the person belongs to', async () => {
    const orgRow = {
      id: 're-9', ownerType: 'ORG', ownerId: 'org-1', appId: null, organizationId: 'org-1', channelId: 'ch-team',
      channel: { id: 'ch-team', name: 'Team chat', loc: 'chats:team', chatRootUrn: null }, attendeeWorkerId: null, attendeeAgentId: null,
      attendeeUrn: null, role: 'BOTH', mentionOnly: false, installDefault: false, description: null, createdAt: '',
    };
    const member = await mountIt(await okPanel({ orgRows: [orgRow] }), { orgIds: ['org-1'] });
    expect([...member.querySelectorAll<HTMLAnchorElement>('a')].some((a) => a.getAttribute('href') === '/app/orgs/org-1/channels')).toBe(true);
    document.body.innerHTML = '';
    const outsider = await mountIt(await okPanel({ orgRows: [orgRow] }), { orgIds: [] });
    expect([...outsider.querySelectorAll<HTMLAnchorElement>('a')].some((a) => a.getAttribute('href') === '/app/orgs/org-1/channels')).toBe(false);
  });
});
