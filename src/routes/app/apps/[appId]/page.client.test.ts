/** Mounted App-page coverage for team chat roster reactivity (#979). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { navigationCalls, navigationGuards, resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { submitEnhanced } from '$lib/test/stubs/app-forms';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
import type { TeamChatMessage } from '$lib/types';
import { AGENT_CHAT_KEY } from '$lib/app-chats';
import Page from './+page.svelte';
import {
  addAgentSchema, appSettingsSchema, castWorkerSchema, createAppKeySchema,
  deleteAppSchema, releaseWorkerSchema, removeAppAgentSchema, retireWorkerSchema,
  revokeAppKeySchema, updateAppAgentToolsSchema,
} from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'hidden');
  resetNavigationCalls();
  resetNavigationGuards();
  window.history.replaceState({}, '', '/');
});

function message(seq: number, authorWorkerId: string): TeamChatMessage {
  return {
    nodeId: `m${seq}`, seq, body: `body ${seq}`, at: '2026-09-30T12:00:00.000Z',
    authorUserId: null, authorWorkerId, authorName: seq === 1 ? 'Ada' : 'Dara',
    sessionId: null, replyToSeq: null, mentions: [], urn: null,
  };
}

async function pageData() {
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
      role: 'OWNER', surfaces: [], agentId: null, agent: null, agents: [], keys: [],
    },
    org: null, availableAgents: [], staff: [
      { id: 'w1', name: 'Ada', urn: 'hrn:worker:acme.com:team:ada', retiredAt: null },
    ],
    staffError: false,
    teamChatMessages: [message(1, 'w1')], teamChatTotal: 1, teamChatError: false,
    appChats: [{ key: 'chats:team', label: 'Team chat' }], chatsError: false,
    selectedChatKey: 'chats:team', initialTab: 'chats', initialChatFullView: false,
    chatConfigs: [], appConfigs: [], worklog: [], worklogTotal: 0, worklogError: false,
    currentUserId: 'u1',
    appSettingsForm, addAgentForm, createKeyForm, removeAgentForm,
    updateAgentToolsForm, revokeKeyForm, deleteAppForm, castWorkerForm,
    retireWorkerForm, releaseWorkerForm, postTeamChatMessageForm,
  };
}

describe('App team chat roster refresh', () => {
  it('renders a new worker URN after a failed lookup and a successful retry on an empty poll', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=chats', { appId: 'a1' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url);
      if (url.endsWith('sinceSeq=1')) return {
        ok: true, json: async () => ({ items: [message(2, 'w2')], total: 1, loadFailed: false }),
      } as Response;
      if (url.endsWith('sinceSeq=2')) return {
        ok: true, json: async () => ({ items: [], total: 0, loadFailed: false }),
      } as Response;
      if (url.endsWith('/team-chat/authors')) {
        const failed = requests.filter((request) => request.endsWith('/team-chat/authors')).length === 1;
        return {
          ok: true,
          json: async () => failed
            ? { workers: [], loadFailed: true }
            : { workers: [
                { id: 'w1', urn: 'hrn:worker:acme.com:team:ada' },
                { id: 'w2', urn: 'hrn:worker:acme.com:team:dara' },
              ], loadFailed: false },
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    vi.useFakeTimers();
    const m = mountComponent(Page as never, { data: await pageData(), form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    expect(m.target.textContent).toContain('acme.com:team:ada');

    await vi.advanceTimersByTimeAsync(8000);
    await tick(3);
    expect(m.target.textContent).toContain('body 2');
    expect(m.target.textContent).not.toContain('acme.com:team:dara');

    await vi.advanceTimersByTimeAsync(8000);
    await tick(3);
    expect(requests.filter((url) => url.endsWith('/team-chat/authors'))).toHaveLength(2);
    expect(m.target.textContent).toContain('acme.com:team:dara');
  });
});

describe('App team chat full view (#980)', () => {
  it('keeps full view through a post revalidation, then follows a real navigation out', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=chats&chat=chats%3Ateam', { appId: 'a1' });
    window.history.replaceState({}, '', '/app/apps/a1?tab=chats&chat=chats%3Ateam');
    const props = reactiveProps({ data: await pageData(), form: null });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);

    const toggle = () => Array.from(m.target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Full view') || button.textContent?.includes('Exit full view'))!;
    toggle().click();
    await tick(2);
    expect(m.target.querySelector('[aria-modal="true"]')).not.toBeNull();
    const url = navigationCalls.at(-1)?.args[0] as URL;
    expect(url.searchParams.get('view')).toBe('full');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);

    // SvelteKit shallow replaceState changes the address bar but its
    // invalidateAll re-runs the loader with the earlier internal URL.
    props.data = { ...props.data, teamChatMessages: [message(1, 'w1'), message(2, 'w1')], initialChatFullView: false };
    await tick(3);
    expect(m.target.querySelector('[aria-modal="true"]')).not.toBeNull();
    expect(toggle().textContent).toContain('Exit full view');
    expect(new URL(window.location.href).searchParams.get('view')).toBe('full');

    // A genuine navigation does have to take the new loader's view selection.
    window.history.replaceState({}, '', '/app/apps/a1?tab=chats&chat=chats%3Ateam');
    const afterNavigate = navigationGuards.find((guard) => guard.fn === 'afterNavigate')?.callback as ((nav: { type: string }) => void) | undefined;
    expect(afterNavigate).toBeDefined();
    afterNavigate!({ type: 'link' });
    await tick(2);
    expect(m.target.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it('Ctrl+Enter and Cmd+Enter submit the full-view composer', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=chats&chat=chats%3Ateam', { appId: 'a1' });
    window.history.replaceState({}, '', '/app/apps/a1?tab=chats&chat=chats%3Ateam');
    const m = mountComponent(Page as never, { data: await pageData(), form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    Array.from(m.target.querySelectorAll('button')).find((button) => button.textContent?.includes('Full view'))!.click();
    await tick(2);
    const textarea = m.target.querySelector<HTMLTextAreaElement>('#team-chat-body')!;
    expect(textarea.placeholder).toContain('Ctrl/Cmd+Enter');
    textarea.value = 'send this';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(2);
    const form = textarea.form!;
    expect(form.getAttribute('action')).toContain('view=full');
    const requestSubmit = vi.spyOn(form, 'requestSubmit').mockImplementation(() => {});
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      const event = new KeyboardEvent('keydown', { key: 'Enter', ...modifier, cancelable: true, bubbles: true });
      textarea.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(requestSubmit).toHaveBeenCalledTimes(2);
    expect((await submitEnhanced(form)).cancelled).toBe(false);
  });
});

describe('Worker agents tab (#1009)', () => {
  async function mountStaff(staff: unknown[]) {
    setStubPage('https://example.test/app/apps/a1?tab=staff', { appId: 'a1' });
    window.history.replaceState({}, '', '/app/apps/a1?tab=staff');
    const data = await pageData();
    const m = mountComponent(Page as never, {
      data: { ...data, user: { id: 'u1' }, initialTab: 'staff', staff },
      form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    return m.target;
  }
  const worker = (over: Record<string, unknown>) => ({
    id: 'w1', name: 'Ada', urn: 'hrn:worker:acme.com:team:ada', role: 'coordinator', retiredAt: null,
    memoryId: 'mem-ada', agent: { id: 'ag-coord', name: 'Coordinator' }, heldByUserId: 'u1', heldAt: '2026-10-01T00:00:00.000Z',
    ...over,
  });
  function menuOf(target: HTMLElement, name: string) {
    target.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${name}"]`)!.click();
    flushSync();
    const items = [...target.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].map((i) => [i.textContent?.trim(), i.getAttribute('href')]);
    target.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${name}"]`)!.click();
    flushSync();
    return items;
  }

  it('puts the URN on the name’s second line, with no URN column', async () => {
    const target = await mountStaff([worker({})]);
    expect([...target.querySelectorAll('thead th')].map((th) => th.textContent?.trim())).not.toContain('URN');
    const nameCell = target.querySelector('a[href="/app/workers/w1"]')!.closest('td')!;
    // The Urn chip renders its segments as separate elements; compare without the gaps.
    expect(nameCell.textContent?.replace(/\s+/g, '')).toContain('hrn:worker:acme.com:team:ada');
  });

  it('an active worker you hold: Edit, Open working memory, Open role agent, Release, Retire', async () => {
    const target = await mountStaff([worker({})]);
    expect(menuOf(target, 'Ada')).toEqual([
      ['Edit', '/app/workers/w1?tab=briefing&view=source'],
      ['Open working memory', '/app/memories/mem-ada'],
      ['Open role agent', '/app/agents/ag-coord'],
      ['Release', null],
      ['Retire', null],
    ]);
  });

  it('someone else’s hold offers Force-release; an unknown hold offers no release at all', async () => {
    const target = await mountStaff([
      worker({ id: 'w2', name: 'Bo', heldByUserId: 'u9' }),
      worker({ id: 'w3', name: 'Cy', heldByUserId: null, heldAt: null }),
    ]);
    expect(menuOf(target, 'Bo').map(([l]) => l)).toContain('Force-release');
    expect(menuOf(target, 'Cy').map(([l]) => l)).toEqual(['Edit', 'Open working memory', 'Open role agent', 'Retire']);
  });

  it('a retired worker keeps only the links: nothing to edit, release or retire', async () => {
    const target = await mountStaff([worker({ id: 'w4', name: 'Dee', retiredAt: '2026-09-01T00:00:00.000Z' })]);
    expect(menuOf(target, 'Dee').map(([l]) => l)).toEqual(['Open working memory', 'Open role agent']);
  });

  // Cody's #1048 QA: the menu CONTENTS were pinned, the DISPATCH was not.
  function pick(target: HTMLElement, name: string, label: string) {
    target.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${name}"]`)!.click();
    flushSync();
    [...target.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find((i) => i.textContent?.trim() === label)!.click();
  }

  it('picking Retire submits the retire form for THAT worker, uncancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountStaff([worker({}), worker({ id: 'w2', name: 'Bo', urn: 'hrn:worker:acme.com:team:bo' })]);
    pick(target, 'Bo', 'Retire');
    await tick(2);
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    const form = requestSubmit.mock.contexts[0] as HTMLFormElement;
    expect(form.getAttribute('action')).toBe('?/retireWorker');
    expect(form.querySelector<HTMLInputElement>('input[name="workerId"]')!.value).toBe('w2');
    expect((await submitEnhanced(form)).cancelled).toBe(false);
  });

  it('picking Release submits the release form for THAT worker, asserting the hold the row showed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountStaff([worker({}), worker({ id: 'w2', name: 'Bo', urn: 'hrn:worker:acme.com:team:bo', heldByUserId: 'u9' })]);
    pick(target, 'Bo', 'Force-release');
    await tick(2);
    const form = requestSubmit.mock.contexts[0] as HTMLFormElement;
    expect(form.getAttribute('action')).toBe('?/releaseWorker');
    expect(form.querySelector<HTMLInputElement>('input[name="workerId"]')!.value).toBe('w2');
    expect(form.querySelector<HTMLInputElement>('input[name="expectedHolderUserId"]')!.value).toBe('u9');
    expect((await submitEnhanced(form)).cancelled).toBe(false);
  });

  it('a declined Retire confirm submits nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountStaff([worker({})]);
    pick(target, 'Ada', 'Retire');
    await tick(2);
    expect(requestSubmit).not.toHaveBeenCalled();
  });

  it('search still matches the URN, now that it lives in the Name cell', async () => {
    const target = await mountStaff([
      worker({}),
      worker({ id: 'w2', name: 'Bo', urn: 'hrn:worker:acme.com:team:zeta-slug' }),
    ]);
    const search = target.querySelector<HTMLInputElement>('input[aria-label="Search worker agents"]')!;
    search.value = 'zeta-slug';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(3);
    const names = [...target.querySelectorAll('tbody a[href^="/app/workers/"]')].map((a) => a.textContent?.trim());
    expect(names).toEqual(['Bo']);
  });

  it('a retired worker with no memory and no agent gets no ⋯ at all, not an empty menu', async () => {
    const target = await mountStaff([worker({ id: 'w5', name: 'Eve', retiredAt: '2026-09-01T00:00:00.000Z', memoryId: null, agent: null })]);
    expect(target.querySelector('button[aria-label="Actions for Eve"]')).toBeNull();
  });
});

describe('App header (#1010)', () => {
  it('shows no "read-only" badge when the first installed agent holds only read grants', async () => {
    // The exact state that used to raise the badge: `app.agent` (the FIRST
    // installed agent, soft-deprecated) with no read-write memory item. A team
    // App's first agent is typically its role-less team agent, while the App
    // writes through its other agents, its shared memory and its workers'
    // working memories — none of which the badge looked at.
    setStubPage('https://example.test/app/apps/a1', { appId: 'a1' });
    const data = await pageData();
    const teamAgent = {
      id: 'ag1', name: 'Team Agent', urn: 'hrn:agent:acme.com:team', personaRole: null,
      memoryItems: [{ role: 'read', memory: { id: 'm1', urn: 'hrn:mem:acme.com:core', name: 'Core' } }],
    };
    const m = mountComponent(Page as never, {
      data: { ...data, app: { ...data.app, agentId: 'ag1', agent: teamAgent, agents: [teamAgent] } },
      form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const heading = m.target.querySelector('h1')!;
    expect(heading.textContent).toContain('Team');
    expect(heading.textContent?.toLowerCase()).not.toContain('read-only');
  });
});

describe('App Keys and AI Service Configs tabs (#1007/#1008)', () => {
  const key = {
    id: 'k1', label: 'production-backend', keyPreview: 'hk_ab…yz',
    createdAt: '2026-10-01T12:00:00.000Z', lastUsedAt: null, revokedAt: null,
  };
  async function keyedData(initialTab: string) {
    const data = await pageData();
    return { ...data, initialTab, app: { ...data.app, keys: [key] } };
  }
  async function revokeResult() {
    const f = await superValidate({ _kind: 'revokeKey', keyId: 'k1' }, zod4(revokeAppKeySchema));
    f.message = { type: 'success', text: 'Key revoked.' };
    return { form: f };
  }
  const selectedTab = (m: Mounted<Record<string, unknown>>) =>
    m.target.querySelector('[role="tab"][aria-selected="true"]')?.id;

  it('gives each list its own tab and takes both out of Settings', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=keys', { appId: 'a1' });
    const props = reactiveProps({ data: await keyedData('keys'), form: null });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);

    const labels = Array.from(m.target.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(['App Keys', 'AI Service Configs', 'Settings']));

    const keysPanel = m.target.querySelector('#panel-keys')!;
    expect(keysPanel.getAttribute('aria-labelledby')).toBe('tab-keys');
    expect(keysPanel.textContent).toContain('+ Generate Key');
    expect(keysPanel.textContent).toContain('production-backend');

    (m.target.querySelector('#tab-ai-configs') as HTMLButtonElement).click();
    await tick(2);
    const configsPanel = m.target.querySelector('#panel-ai-configs')!;
    expect(configsPanel.textContent).toContain('AI providers');
    expect(m.target.querySelector('#panel-keys')).toBeNull();

    (m.target.querySelector('#tab-settings') as HTMLButtonElement).click();
    await tick(2);
    const settingsPanel = m.target.querySelector('#panel-settings')!;
    expect(settingsPanel.textContent).not.toContain('Generate Key');
    expect(settingsPanel.textContent).not.toContain('production-backend');
    expect(settingsPanel.textContent).not.toContain('AI providers');
  });

  // A fresh page (a full POST before hydration) is followed by SvelteKit
  // firing every afterNavigate callback with type 'enter' — after effects and
  // onMount. The stub only RECORDS callbacks, so fire them as kit would, or
  // the page's re-sync to `data.initialTab` stays invisible (Gemma on #1034).
  const enterNavigation = async () => {
    for (const guard of navigationGuards.filter((g) => g.fn === 'afterNavigate')) {
      (guard.callback as (nav: { type: string }) => void)({ type: 'enter' });
    }
    await tick(2);
  };

  it('opens App Keys for a key action result that arrives on a fresh page', async () => {
    setStubPage('https://example.test/app/apps/a1', { appId: 'a1' });
    const m = mountComponent(Page as never, {
      data: await keyedData('chats'), form: await revokeResult(),
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    await enterNavigation();
    expect(selectedTab(m)).toBe('tab-keys');
    expect(m.target.textContent).toContain('Key revoked.');
  });

  it('opens Agents for an agent action result that arrives on a fresh page (#1006)', async () => {
    setStubPage('https://example.test/app/apps/a1', { appId: 'a1' });
    const f = await superValidate({ _kind: 'removeAgent', agentId: 'ag1' }, zod4(removeAppAgentSchema));
    f.message = { type: 'success', text: 'Agent removed.' };
    const m = mountComponent(Page as never, {
      data: await keyedData('chats'), form: { form: f },
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    await enterNavigation();
    expect(selectedTab(m)).toBe('tab-agents');
  });

  it('still follows the loader on an enter navigation with no action result', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=worklog', { appId: 'a1' });
    const m = mountComponent(Page as never, {
      data: await keyedData('worklog'), form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    (m.target.querySelector('#tab-keys') as HTMLButtonElement).click();
    await tick(2);
    await enterNavigation();
    expect(selectedTab(m)).toBe('tab-worklog');
  });

  it('keeps a revoke made from the Client tab on the Client tab', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=client', { appId: 'a1' });
    const props = reactiveProps<Record<string, unknown>>({ data: await keyedData('client'), form: null });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    expect(selectedTab(m)).toBe('tab-client');

    props.form = await revokeResult();
    await tick(3);
    expect(selectedTab(m)).toBe('tab-client');
  });
});

describe('Chats tab, no LLM config (#1007/#1008, Cody on #1034)', () => {
  it('sends the reader to AI Service Configs, where the providers now live', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=chats', { appId: 'a1' });
    const data = await pageData();
    const m = mountComponent(Page as never, {
      data: {
        ...data,
        app: { ...data.app, surfaces: ['chat'], agentId: 'ag1', agent: { id: 'ag1', name: 'Bot' } },
        chatConfigs: [], selectedChatKey: AGENT_CHAT_KEY,
      },
      form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const cta = Array.from(m.target.querySelectorAll('button')).find((b) => b.textContent?.includes('Configure AI Service Configs'));
    expect(cta).toBeDefined();
    cta!.click();
    await tick(2);
    expect(m.target.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe('tab-ai-configs');
    expect(m.target.querySelector('#panel-ai-configs')).not.toBeNull();
  });
});

// portal#1068 — the Client tab's "Download setup files" mints a key through
// /api/create-app-key. A manager refusal must reach the reader as the rule,
// not as "Failed to create client key." with the reason dropped.
describe('Client tab: a refused key mint (#1068)', () => {
  const MANAGERS_ONLY = 'Only the App’s managers can create or revoke its keys: its owners and the organization’s admins.';

  async function mountClient(fetchImpl: (url: string) => Promise<Response>) {
    setStubPage('https://example.test/app/apps/a1?tab=client', { appId: 'a1' });
    window.history.replaceState({}, '', '/app/apps/a1?tab=client');
    vi.stubGlobal('fetch', vi.fn(fetchImpl));
    const data = await pageData();
    const m = mountComponent(Page as never, {
      data: { ...data, app: { ...data.app, agentTools: ['CLAUDE_CODE'] }, user: { id: 'u1' }, initialTab: 'client' },
      form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const label = m.target.querySelector<HTMLInputElement>('input#keyLabel')!;
    label.value = 'laptop';
    label.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    return m.target;
  }
  function downloadButton(target: HTMLElement) {
    return [...target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Download setup files'))!;
  }

  it('shows the server’s refusal copy, not a generic alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const target = await mountClient(async () =>
      new Response(JSON.stringify({ error: MANAGERS_ONLY }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
    downloadButton(target).click();
    await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).not.toBeNull());
    expect(alertSpy).not.toHaveBeenCalled();
    const alertEl = [...target.querySelectorAll('[role="alert"]')].find((el) => el.textContent?.includes(MANAGERS_ONLY));
    expect(alertEl).toBeTruthy();
    expect(target.textContent).not.toContain('Failed to create client key.');
  });

  it('a body with no error text falls back to the generic copy, inline', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const target = await mountClient(async () => new Response('gateway', { status: 502 }));
    downloadButton(target).click();
    await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).not.toBeNull());
    const alertEl = [...target.querySelectorAll('[role="alert"]')].find((el) => el.textContent?.includes('Failed to create client key.'));
    expect(alertEl).toBeTruthy();
  });
});
