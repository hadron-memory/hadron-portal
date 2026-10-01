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
    const afterNavigate = navigationGuards.find((guard) => guard.fn === 'afterNavigate')?.callback as (() => void) | undefined;
    expect(afterNavigate).toBeDefined();
    afterNavigate!();
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
