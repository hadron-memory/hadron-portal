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
