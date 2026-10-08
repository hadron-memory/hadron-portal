/** Mounted App-page coverage for team chat roster reactivity (#979). */
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('opens Settings for an agent action result that arrives on a fresh page', async () => {
    setStubPage('https://example.test/app/apps/a1', { appId: 'a1' });
    const f = await superValidate({ _kind: 'removeAgent', agentId: 'ag1' }, zod4(removeAppAgentSchema));
    f.message = { type: 'success', text: 'Agent removed.' };
    const m = mountComponent(Page as never, {
      data: await keyedData('chats'), form: { form: f },
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    await enterNavigation();
    expect(selectedTab(m)).toBe('tab-settings');
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
