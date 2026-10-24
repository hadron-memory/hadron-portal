/** #1020: the App page's Agents (Unlink) and Keys (Revoke) rows use a ⋯ menu,
 *  each action submitted through one hidden form below its table. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { submitEnhanced } from '$lib/test/stubs/app-forms';
import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
import Page from './+page.svelte';
import {
  addAgentSchema, appSettingsSchema, castWorkerSchema, createAppKeySchema,
  deleteAppSchema, releaseWorkerSchema, removeAppAgentSchema,
  retireWorkerSchema, revokeAppKeySchema, updateAppAgentToolsSchema,
} from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

const AGENT = { id: 'ag1', urn: 'hrn:agent:acme.com:beta', name: 'Beta', personaRole: null };
const KEY = { id: 'k1', keyPreview: 'abc123', label: 'CI', createdAt: '2026-10-01T00:00:00Z', lastUsedAt: null, revokedAt: null };

async function pageData(initialTab: 'agents' | 'keys') {
  const [appSettingsForm, addAgentForm, createKeyForm, removeAgentForm,
    updateAgentToolsForm, revokeKeyForm, deleteAppForm, castWorkerForm,
    retireWorkerForm, releaseWorkerForm, postTeamChatMessageForm] = await Promise.all([
    appSettingsSchema, addAgentSchema, createAppKeySchema, removeAppAgentSchema,
    updateAppAgentToolsSchema, revokeAppKeySchema, deleteAppSchema, castWorkerSchema,
    retireWorkerSchema, releaseWorkerSchema, postTeamChatMessageSchema,
  ].map((schema) => superValidate(zod4(schema), { errors: false })));
  return {
    app: {
      id: 'a1', urn: 'hrn:app:acme.com:team', name: 'Team', appType: 'WORKSTATION',
      role: 'OWNER', surfaces: [], agentId: null, agent: null,
      agents: initialTab === 'agents' ? [AGENT] : [],
    },
    appKeys: { kind: 'ok', keys: initialTab === 'keys' ? [KEY] : [] },
    viewerManages: { kind: 'known', manages: true },
    org: null, availableAgents: [], staff: [], staffError: false,
    teamChatMessages: [], teamChatTotal: 0, teamChatError: false,
    appChats: [], chatsError: false, selectedChatKey: null,
    initialTab, initialChatFullView: false,
    chatConfigs: [], appConfigs: [], worklog: [], worklogTotal: 0, worklogError: false,
    currentUserId: 'u1',
    appSettingsForm, addAgentForm, createKeyForm, removeAgentForm,
    updateAgentToolsForm, revokeKeyForm, deleteAppForm, castWorkerForm,
    retireWorkerForm, releaseWorkerForm, postTeamChatMessageForm,
  };
}

async function mountTab(tab: 'agents' | 'keys') {
  setStubPage(`https://example.test/app/apps/a1?tab=${tab}`, { appId: 'a1' });
  // The page may poll chats/authors from onMount regardless of tab; any
  // fetch it makes can resolve empty — these tests are about the menus.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response));
  const m = mountComponent(Page as never, { data: await pageData(tab), form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

function openMenu(target: HTMLElement, ariaLabel: string) {
  target.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`)!.click();
  flushSync();
  return [...target.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];
}

describe('App Agents tab row ⋯ menu (#1020)', () => {
  it('offers the row actions only in the menu — Set boot prompt (#1142) and Unlink — with no inline buttons', async () => {
    const target = await mountTab('agents');
    expect(target.textContent).not.toContain('Unlink');
    const items = openMenu(target, 'Actions for Beta');
    expect(items.map((i) => [i.tagName, i.textContent?.trim()])).toEqual([
      ['BUTTON', 'Set boot prompt…'],
      ['BUTTON', 'Unlink'],
    ]);
  });

  it('Unlink submits the hidden removeAgent form for the PICKED agent', async () => {
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountTab('agents');
    openMenu(target, 'Actions for Beta').find((i) => i.textContent?.trim() === 'Unlink')!.click();
    await tick(2);
    const form = requestSubmit.mock.contexts[0] as HTMLFormElement;
    expect(form.getAttribute('action')).toBe('?/removeAgent');
    expect(form.querySelector<HTMLInputElement>('input[name="agentId"]')!.value).toBe('ag1');
    expect((await submitEnhanced(form)).cancelled).toBe(false);
  });
});

describe('App Keys tab row ⋯ menu (#1020)', () => {
  it('offers Revoke as the only menu item, with no inline Revoke button', async () => {
    const target = await mountTab('keys');
    expect(target.textContent).not.toContain('Revoke');
    const items = openMenu(target, 'Actions for key abc123');
    expect(items.map((i) => [i.tagName, i.textContent?.trim()])).toEqual([['BUTTON', 'Revoke']]);
  });

  it('Revoke confirms, then submits the hidden revokeKey form for the PICKED key', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountTab('keys');
    openMenu(target, 'Actions for key abc123').find((i) => i.textContent?.trim() === 'Revoke')!.click();
    await tick(2);
    const form = requestSubmit.mock.contexts[0] as HTMLFormElement;
    expect(form.getAttribute('action')).toBe('?/revokeKey');
    expect(form.querySelector<HTMLInputElement>('input[name="keyId"]')!.value).toBe('k1');
    expect((await submitEnhanced(form)).cancelled).toBe(false);
  });

  it('a declined confirm submits nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountTab('keys');
    openMenu(target, 'Actions for key abc123').find((i) => i.textContent?.trim() === 'Revoke')!.click();
    await tick(2);
    expect(requestSubmit).not.toHaveBeenCalled();
  });
});
