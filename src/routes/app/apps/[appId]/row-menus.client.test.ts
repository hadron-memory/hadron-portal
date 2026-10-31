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

async function pageData(initialTab: 'agents' | 'keys', agents: unknown[] = [AGENT]) {
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
      agents: initialTab === 'agents' ? agents : [],
    },
    appKeys: { kind: 'ok', keys: initialTab === 'keys' ? [KEY] : [] },
    viewerManages: { kind: 'known', manages: true },
    org: null, availableAgents: [], staff: [], staffError: false,
    teamChatMessages: [], teamChatTotal: 0, teamChatError: false, teamFilter: { kind: 'none' }, teamFilterInvalid: false, teamChatRefusal: null,
    appChats: [], chatsError: false, selectedChatKey: null,
    initialTab, initialChatFullView: false, bootPointerAppKey: 'a1',
    chatConfigs: [], appConfigs: [], worklog: [], worklogTotal: 0, worklogError: false,
    currentUserId: 'u1',
    appSettingsForm, addAgentForm, createKeyForm, removeAgentForm,
    updateAgentToolsForm, revokeKeyForm, deleteAppForm, castWorkerForm,
    retireWorkerForm, releaseWorkerForm, postTeamChatMessageForm,
  };
}

async function mountTab(tab: 'agents' | 'keys', agents: unknown[] = [AGENT]) {
  setStubPage(`https://example.test/app/apps/a1?tab=${tab}`, { appId: 'a1' });
  // The page may poll chats/authors from onMount regardless of tab; any
  // fetch it makes can resolve empty — these tests are about the menus.
  vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: true, json: async () => String(url).includes('/customisation?') ? { list: { state: 'not-shown' }, original: { state: 'not-shown' }, replacement: { state: 'not-shown' } } : {} }) as Response));
  const m = mountComponent(Page as never, { data: await pageData(tab, agents), form: null } as never) as Mounted<Record<string, unknown>>;
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
  it('offers the row actions only in the menu — Customisation, Set boot prompt (#1142) and Unlink — with no inline buttons', async () => {
    const target = await mountTab('agents');
    expect(target.textContent).not.toContain('Unlink');
    const items = openMenu(target, 'Actions for Beta');
    expect(items.map((i) => [i.tagName, i.textContent?.trim()])).toEqual([
      ['BUTTON', 'Customisation…'],
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

describe('customisation panel focus from the real row menu', () => {
  it('reveals an already-open panel again and returns focus on Close', async () => {
    const target = await mountTab('agents');
    const pick = () =>
      openMenu(target, 'Actions for Beta')
        .find((i) => i.textContent?.trim() === 'Customisation…')!
        .click();
    pick();
    await tick(4);
    await new Promise((r) => setTimeout(r, 0));
    await tick(4);
    const panel = target.querySelector<HTMLElement>(
      'section[aria-label="Customisation"]',
    )!;
    expect(document.activeElement).toBe(panel.querySelector('h3'));
    pick();
    await tick(4);
    expect(document.activeElement).toBe(panel.querySelector('h3'));
    [...panel.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === 'Close')!
      .click();
    await tick(4);
    expect(
      target.querySelector('section[aria-label="Customisation"]'),
    ).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Actions for Beta',
    );
  });
});

const GAMMA = { id: 'ag2', urn: 'hrn:agent:acme.com:gamma', name: 'Gamma', personaRole: null };
async function settle() {
  await tick(4);
  await new Promise((r) => setTimeout(r, 0));
  await tick(4);
}
const pickCustomisation = (target: HTMLElement, name: string) =>
  openMenu(target, `Actions for ${name}`)
    .find((i) => i.textContent?.trim() === 'Customisation…')!
    .click();
const panelHeading = (target: HTMLElement) =>
  target.querySelector('section[aria-label="Customisation"] h3')?.textContent?.trim();

describe('switching Agents with an unsaved customisation draft (#1369)', () => {
  async function dirtyBeta() {
    const target = await mountTab('agents', [AGENT, GAMMA]);
    pickCustomisation(target, 'Beta');
    await settle();
    [...target.querySelectorAll<HTMLButtonElement>('section[aria-label="Customisation"] button')]
      .find((b) => b.textContent?.trim() === 'Start customising')!
      .click();
    await settle();
    // Metadata only: a typed loc with the content still empty is unsaved.
    const locInput = target.querySelector<HTMLInputElement>('section[aria-label="Customisation"] form input')!;
    locInput.value = 'boot:extra';
    locInput.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    return { target, locInput };
  }
  it('asks before re-keying, and Cancel keeps the draft and the selected Agent', async () => {
    const { target } = await dirtyBeta();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    pickCustomisation(target, 'Gamma');
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(panelHeading(target)).toBe('Customisation for Beta');
    expect(
      target.querySelector<HTMLInputElement>('section[aria-label="Customisation"] form input')?.value,
    ).toBe('boot:extra');
  });
  it('accepting switches once and saves nothing', async () => {
    const { target } = await dirtyBeta();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    pickCustomisation(target, 'Gamma');
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(panelHeading(target)).toBe('Customisation for Gamma');
    const posts = vi.mocked(fetch).mock.calls.filter(([, o]) => (o as RequestInit | undefined)?.method === 'POST');
    expect(posts).toHaveLength(0);
  });
  it('a clean panel switches without asking', async () => {
    const target = await mountTab('agents', [AGENT, GAMMA]);
    const confirm = vi.spyOn(window, 'confirm');
    pickCustomisation(target, 'Beta');
    await settle();
    pickCustomisation(target, 'Gamma');
    await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(panelHeading(target)).toBe('Customisation for Gamma');
  });
});

describe('closing the customisation panel when its opener is gone (#1369)', () => {
  it('returns focus to the Agents heading, which shows a focus ring', async () => {
    const target = await mountTab('agents', [AGENT, GAMMA]);
    pickCustomisation(target, 'Beta');
    await settle();
    const search = target.querySelector<HTMLInputElement>('input[aria-label="Search agents"]')!;
    search.value = 'Gamma';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(target.querySelector('button[aria-label="Actions for Beta"]')).toBeNull();
    [...target.querySelectorAll<HTMLButtonElement>('section[aria-label="Customisation"] button')]
      .find((b) => b.textContent === 'Close')!
      .click();
    await settle();
    const heading = document.activeElement as HTMLElement;
    expect(heading.tagName).toBe('H2');
    expect(heading.textContent?.trim()).toBe('Agents');
    expect(heading.className).toMatch(/focus:outline/);
  });
});
