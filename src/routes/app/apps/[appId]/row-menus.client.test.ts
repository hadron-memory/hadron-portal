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

const IMPORTER = { id: 'ag0', name: 'Alpha', urn: 'hrn:agent:acme.com:alpha' };

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

async function mountTab(tab: 'agents' | 'keys', over: Record<string, unknown> = {}) {
  setStubPage(`https://example.test/app/apps/a1?tab=${tab}`, { appId: 'a1' });
  // The page may poll chats/authors from onMount regardless of tab; any
  // fetch it makes can resolve empty — these tests are about the menus.
  vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: true, json: async () => String(url).includes('/customisation?') ? { list: { state: 'not-shown' }, original: { state: 'not-shown' }, replacement: { state: 'not-shown' } } : {} }) as Response));
  const m = mountComponent(Page as never, { data: { ...(await pageData(tab)), ...over }, form: null } as never) as Mounted<Record<string, unknown>>;
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

describe('A derived agent on the Agents tab (#1684)', () => {
  const mark = (target: HTMLElement) => target.querySelector('[data-testid="install-mark"]');

  it('says it is derived, names the importer and shows its URN', async () => {
    const target = await mountTab('agents', { installMarks: { ag1: { kind: 'derived', importer: IMPORTER } } });
    expect(mark(target)!.textContent).toContain('Derived from');
    expect(mark(target)!.querySelector('a')!.getAttribute('href')).toBe('/app/agents/ag0');
    expect(mark(target)!.textContent).toContain('Alpha');
    expect(mark(target)!.textContent).toContain('acme.com:alpha');
  });

  it('an installed agent says Installed', async () => {
    const target = await mountTab('agents', { installMarks: { ag1: { kind: 'installed' } } });
    expect(mark(target)!.textContent?.trim()).toBe('Installed');
  });

  it('a withheld answer draws no mark at all', async () => {
    const target = await mountTab('agents', { installMarks: {} });
    expect(target.querySelector('tbody')!.textContent).toContain('Beta');
    expect(mark(target)).toBeNull();
    expect(target.querySelector('tbody')!.textContent).not.toContain('Installed');
  });

  it('the search finds a derived agent by its importer', async () => {
    const target = await mountTab('agents', { installMarks: { ag1: { kind: 'derived', importer: IMPORTER } } });
    const search = target.querySelector<HTMLInputElement>('input[aria-label="Search agents"]')!;
    search.value = 'Alpha';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(3);
    expect(target.querySelector('tbody')!.textContent).toContain('Beta');
  });

  it('offers Install and not Unlink: there is no row to remove', async () => {
    const target = await mountTab('agents', { installMarks: { ag1: { kind: 'derived', importer: IMPORTER } } });
    expect(openMenu(target, 'Actions for Beta').map((i) => i.textContent?.trim())).toEqual(['Customisation…', 'Set boot prompt…', 'Install']);
  });

  it('a viewer who can\u2019t manage the App isn\u2019t offered Install', async () => {
    const target = await mountTab('agents', { canManageApp: false, installMarks: { ag1: { kind: 'derived', importer: IMPORTER } } });
    expect(openMenu(target, 'Actions for Beta').map((i) => i.textContent?.trim())).not.toContain('Install');
  });

  it('Install submits the addAgent action for the PICKED agent, under a form id of its own', async () => {
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountTab('agents', { installMarks: { ag1: { kind: 'derived', importer: IMPORTER } } });
    openMenu(target, 'Actions for Beta').find((i) => i.textContent?.trim() === 'Install')!.click();
    await tick(2);
    const form = requestSubmit.mock.contexts[0] as HTMLFormElement;
    expect(form.getAttribute('action')).toBe('?/addAgent');
    expect(form.querySelector<HTMLInputElement>('input[name="agentId"]')!.value).toBe('ag1');
    expect(form.querySelector<HTMLInputElement>('input[name="__superform_id"]')!.value).toMatch(/^installAgent:/);
    expect((await submitEnhanced(form)).cancelled).toBe(false);
  });

  it('the cast form groups a derived agent apart and names its importer', async () => {
    const coach = { id: 'ag2', urn: 'hrn:agent:acme.com:coach', name: 'Coach', personaRole: 'coach' };
    const beta = { ...AGENT, personaRole: 'analyst' };
    setStubPage('https://example.test/app/apps/a1?tab=staff', { appId: 'a1' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const data = await pageData('agents');
    const m = mountComponent(Page as never, { data: {
      ...data, initialTab: 'staff', app: { ...data.app, agents: [beta, coach] },
      installMarks: { ag1: { kind: 'derived', importer: IMPORTER }, ag2: { kind: 'installed' } },
    }, form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    [...m.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-expanded') === 'false' && /cast/i.test(b.textContent ?? ''))!.click();
    await tick(2);
    const groups = [...m.target.querySelectorAll('#castAgentId optgroup')];
    expect(groups.map((g) => g.getAttribute('label'))).toEqual(['Installed', 'Derived']);
    expect(groups[0].textContent).toContain('Coach (coach)');
    expect(groups[1].textContent).toContain('Beta (analyst), derived from Alpha');
    expect(groups[1].querySelector('option')!.getAttribute('value')).toBe('ag1');
  });

  it('with no derived agent the cast form is the plain list', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=staff', { appId: 'a1' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const data = await pageData('agents');
    const m = mountComponent(Page as never, { data: {
      ...data, initialTab: 'staff', app: { ...data.app, agents: [{ ...AGENT, personaRole: 'analyst' }] }, installMarks: {},
    }, form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    [...m.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-expanded') === 'false' && /cast/i.test(b.textContent ?? ''))!.click();
    await tick(2);
    expect(m.target.querySelector('#castAgentId optgroup')).toBeNull();
    expect(m.target.querySelector('#castAgentId')!.textContent).toContain('Beta (analyst)');
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
