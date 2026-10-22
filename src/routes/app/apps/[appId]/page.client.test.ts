/** Mounted App-page coverage for team chat roster reactivity (#979). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { page, setStubPage } from '$lib/test/stubs/app-stores';
import { navigationCalls, navigationGuards, resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { submitEnhanced, submitEnhancedWithResult, submitEnhancedDeferred } from '$lib/test/stubs/app-forms';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
import type { TeamChatMessage } from '$lib/types';
import { AGENT_CHAT_KEY } from '$lib/app-chats';
import Page from './+page.svelte';
import {
  addAgentSchema, appSettingsSchema, castWorkerSchema, createAppKeySchema,
  deleteAppSchema, releaseWorkerSchema, removeAppAgentSchema, retireWorkerSchema,
  revokeAppKeySchema, updateAppAgentToolsSchema,
  addAppMemberSchema, ensureAppMemberSchema, removeAppMemberSchema,
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
      role: 'OWNER', surfaces: [], agentId: null, agent: null, agents: [],
    },
    appKeys: { kind: 'ok', keys: [] },
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
  async function mountStaff(staff: unknown[], roster: unknown = { kind: 'unavailable' }) {
    setStubPage('https://example.test/app/apps/a1?tab=staff', { appId: 'a1' });
    window.history.replaceState({}, '', '/app/apps/a1?tab=staff');
    const data = await pageData();
    const m = mountComponent(Page as never, {
      data: { ...data, user: { id: 'u1' }, initialTab: 'staff', staff, teamRoster: roster },
      form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    return m.target;
  }
  const worker = (over: Record<string, unknown>) => ({
    id: 'w1', name: 'Ada', urn: 'hrn:worker:acme.com:team:ada', role: 'coordinator', retiredAt: null,
    memoryId: 'mem-ada', agent: { id: 'ag-coord', name: 'Coordinator', systemMemoryId: 'mem-sys' }, family: 'claude', hasLiveSession: true, heldByUserId: 'u1', heldAt: '2026-10-01T00:00:00.000Z',
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

  it('an active worker you hold: Edit, Open working memory, Open system memory, Open role agent, Release, Retire', async () => {
    const target = await mountStaff([worker({})]);
    expect(menuOf(target, 'Ada')).toEqual([
      ['Edit', '/app/workers/w1?tab=briefing&view=source'],
      ['Open working memory', '/app/memories/mem-ada'],
      ['Open system memory', '/app/memories/mem-sys'],
      ['Open role agent', '/app/agents/ag-coord'],
      ['Pause…', null],
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
    expect(menuOf(target, 'Cy').map(([l]) => l)).toEqual(['Edit', 'Open working memory', 'Open system memory', 'Open role agent', 'Pause…', 'Retire']);
  });

  // portal#1168 — the AI Team grid: Status and Model family in, Working memory
  // and Agent columns out (both stay reachable from the ⋯ menu).
  it('drops the Working memory and Agent columns, keeping both links in the menu', async () => {
    const target = await mountStaff([worker({})]);
    const heads = [...target.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
    expect(heads.some((h) => h.startsWith('Working memory'))).toBe(false);
    expect(heads.some((h) => h === 'Agent' || h.startsWith('Agent'))).toBe(false);
    const items = menuOf(target, 'Ada');
    expect(items).toContainEqual(['Open working memory', '/app/memories/mem-ada']);
    expect(items).toContainEqual(['Open role agent', '/app/agents/ag-coord']);
  });

  it('the menu offers the role agent’s system memory only when the server shows it', async () => {
    const target = await mountStaff([
      worker({}),
      worker({ id: 'w2', name: 'Bo', urn: 'hrn:worker:acme.com:team:bo', agent: { id: 'ag-x', name: 'X', systemMemoryId: null } }),
    ]);
    expect(menuOf(target, 'Ada')).toContainEqual(['Open system memory', '/app/memories/mem-sys']);
    expect(menuOf(target, 'Bo').map(([l]) => l)).not.toContain('Open system memory');
  });

  it('shows a Model family column: the bound family, or a dash when none is shown', async () => {
    const target = await mountStaff([
      worker({}),
      worker({ id: 'w2', name: 'Bo', urn: 'hrn:worker:acme.com:team:bo', family: null }),
    ]);
    expect(columnTexts(target, 'Model family')).toEqual(['claude', '—']);
  });

  it('shows a Status column that keeps masked apart from idle and never', async () => {
    const target = await mountStaff([
      worker({ id: 'w1', name: 'Ada', hasLiveSession: true }),
      worker({ id: 'w2', name: 'Bo', urn: 'hrn:worker:acme.com:team:bo', hasLiveSession: false, lastActiveAt: '2026-10-14T10:00:00.000Z' }),
      worker({ id: 'w3', name: 'Cy', urn: 'hrn:worker:acme.com:team:cy', hasLiveSession: false, lastActiveAt: null }),
      worker({ id: 'w4', name: 'Dee', urn: 'hrn:worker:acme.com:team:dee', hasLiveSession: null, lastActiveAt: null }),
    ]);
    expect(columnTexts(target, 'Status')).toEqual(['Active now', 'Idle', 'No recorded activity', 'Not shown to you']);
  });

  // portal#1168 (hadron-server#2178) — Task and Paused, from one bulk roster read.
  const entry = (over: Record<string, unknown> = {}) => ({
    checkStatus: { status: 'OK', pendingReason: null }, pausedUntil: null, currentTask: null, ...over,
  });

  it('shows each worker’s current task, linked, with its status; none is a dash', async () => {
    const target = await mountStaff(
      [worker({}), worker({ id: 'w2', name: 'Bo', urn: 'hrn:worker:acme.com:team:bo' })],
      { kind: 'ok', byWorker: {
        w1: entry({ currentTask: { id: 't9', title: 'Ship the grid', status: 'STARTED' } }),
        w2: entry(),
      } },
    );
    expect(columnTexts(target, 'Task')[0]).toContain('Ship the grid');
    expect(columnTexts(target, 'Task')[0]).toContain('Started');
    expect(target.querySelector('a[href="/app/apps/a1/tasks/t9"]')).not.toBeNull();
    expect(columnTexts(target, 'Task')[1]).toBe('—');
  });

  it('marks a paused worker from the server’s check status, not from pausedUntil alone', async () => {
    const future = '2099-01-01T00:00:00.000Z';
    const target = await mountStaff(
      [worker({}), worker({ id: 'w2', name: 'Bo', urn: 'hrn:worker:acme.com:team:bo' }), worker({ id: 'w3', name: 'Cy', urn: 'hrn:worker:acme.com:team:cy' })],
      { kind: 'ok', byWorker: {
        w1: entry({ checkStatus: { status: 'PENDING', pendingReason: 'PAUSED' }, pausedUntil: future }),
        // An expired stored timestamp is history: the server says OK, so no badge.
        w2: entry({ pausedUntil: '2020-01-01T00:00:00.000Z' }),
        w3: entry({ checkStatus: { status: 'PENDING', pendingReason: 'TEAM_PAUSED' } }),
      } },
    );
    const status = columnTexts(target, 'Status');
    expect(status[0]).toContain('Paused');
    expect(status[1]).not.toContain('Paused');
    expect(status[2]).toContain('Team paused');
  });

  it('says plainly when the roster could not be read or is withheld, and never shows it as no tasks', async () => {
    const failed = await mountStaff([worker({})], { kind: 'failed' });
    expect(failed.textContent).toContain('Task and pause state could not be loaded');
    // Riana/Glen: a failed or withheld roster must not read as "no task".
    expect(columnTexts(failed, 'Task')[0]).toBe('Not available');
    const hidden = await mountStaff([worker({})], { kind: 'hidden' });
    expect(hidden.textContent).toContain('Task and pause state are not shown to you');
    expect(columnTexts(hidden, 'Task')[0]).toBe('Not available');
  });

  // portal#1168 — Pause / Unpause. The portal offers the action and the server's
  // gate decides; "Unpause" only when the SERVER's check status says paused.
  const paused = () => ({ kind: 'ok', byWorker: { w1: entry({ checkStatus: { status: 'PENDING', pendingReason: 'PAUSED' }, pausedUntil: '2099-01-01T00:00:00.000Z' }) } });

  it('offers Unpause only for a worker the server says is paused, and never on a team pause', async () => {
    const target = await mountStaff([worker({})], paused());
    expect(menuOf(target, 'Ada').map(([l]) => l)).toContain('Unpause');
    expect(menuOf(target, 'Ada').map(([l]) => l)).not.toContain('Pause…');
    const teamPaused = await mountStaff([worker({})], { kind: 'ok', byWorker: { w1: entry({ checkStatus: { status: 'PENDING', pendingReason: 'TEAM_PAUSED' } }) } });
    const labels = menuOf(teamPaused, 'Ada').map(([l]) => l);
    expect(labels).not.toContain('Unpause');
  });

  it('offers no pause action on a retired worker', async () => {
    const target = await mountStaff([worker({ retiredAt: '2026-09-01T00:00:00.000Z' })]);
    expect(menuOf(target, 'Ada').map(([l]) => l)).not.toContain('Pause…');
  });

  it('Pause… opens a dialog with an empty end time (no default) and cannot submit until one is chosen', async () => {
    const target = await mountStaff([worker({})]);
    pick(target, 'Ada', 'Pause…');
    await tick(2);
    const dlg = target.querySelector<HTMLElement>('[role="dialog"][aria-label*="Pause"]');
    expect(dlg).not.toBeNull();
    const input = dlg!.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    expect(input.value).toBe('');
    const submit = dlg!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.disabled).toBe(true);
    input.value = '2099-01-01T10:00';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(submit.disabled).toBe(false);
    const hidden = dlg!.querySelector<HTMLInputElement>('input[name="until"]')!;
    expect(hidden.value).toBe(new Date('2099-01-01T10:00').toISOString());
    expect(dlg!.querySelector<HTMLInputElement>('input[name="mode"]')!.value).toBe('pause');
    expect(dlg!.querySelector<HTMLInputElement>('input[name="workerId"]')!.value).toBe('w1');
  });

  it('Unpause submits clear for THAT worker', async () => {
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountStaff([worker({})], paused());
    pick(target, 'Ada', 'Unpause');
    await tick(2);
    const form = target.querySelector<HTMLFormElement>('form[action="?/setWorkerPause"]')!;
    expect(requestSubmit).toHaveBeenCalled();
    expect(form.querySelector<HTMLInputElement>('input[name="workerId"]')!.value).toBe('w1');
    expect(form.querySelector<HTMLInputElement>('input[name="mode"]')!.value).toBe('clear');
    requestSubmit.mockRestore();
  });

  it('a worker the successful roster read did not return is “Not available”, not a quiet dash', async () => {
    const target = await mountStaff(
      [worker({}), worker({ id: 'w2', name: 'Bo', urn: 'hrn:worker:acme.com:team:bo' })],
      { kind: 'ok', byWorker: { w1: entry() } },
    );
    expect(columnTexts(target, 'Task')).toEqual(['—', 'Not available']);
    expect(columnTexts(target, 'Status')[1]).toContain('Pause state unknown');
  });

  it('Unpause cannot be submitted twice while the first is pending', async () => {
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountStaff([worker({})], paused());
    pick(target, 'Ada', 'Unpause');
    await tick(2);
    pick(target, 'Ada', 'Unpause');
    await tick(2);
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    requestSubmit.mockRestore();
  });

  // Colin P2: a delayed answer for one worker/dialog must not act on another.
  it('a delayed success for Ada does not close Bo’s fresh dialog or its draft', async () => {
    const target = await mountStaff([worker({}), worker({ id: 'w2', name: 'Bo', urn: 'hrn:worker:acme.com:team:bo' })]);
    pick(target, 'Ada', 'Pause…');
    await tick(2);
    const adaForm = target.querySelector<HTMLFormElement>('[role="dialog"] form')!;
    const input = () => target.querySelector<HTMLInputElement>('[role="dialog"] input[type="datetime-local"]')!;
    input().value = '2099-01-01T10:00';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const delayed = await submitEnhancedDeferred(adaForm);
    // Ada's dialog is dismissed and Bo's opened with a draft before the answer lands.
    target.querySelector<HTMLButtonElement>('[role="dialog"] button[type="button"]')!.click();
    flushSync();
    pick(target, 'Bo', 'Pause…');
    await tick(2);
    input().value = '2099-02-02T10:00';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await delayed.finish({ type: 'success', status: 200, data: { pauseResult: { ok: true, workerId: 'w1', message: 'Worker paused.' } } });
    await tick(2);
    expect(target.querySelector('[role="dialog"]')).not.toBeNull();
    expect(input().value).toBe('2099-02-02T10:00');
  });

  it('a delayed refusal for Ada does not appear inside Bo’s fresh dialog', async () => {
    const target = await mountStaff([worker({}), worker({ id: 'w2', name: 'Bo', urn: 'hrn:worker:acme.com:team:bo' })]);
    pick(target, 'Ada', 'Pause…');
    await tick(2);
    const adaForm = target.querySelector<HTMLFormElement>('[role="dialog"] form')!;
    const delayed = await submitEnhancedDeferred(adaForm);
    target.querySelector<HTMLButtonElement>('[role="dialog"] button[type="button"]')!.click();
    flushSync();
    pick(target, 'Bo', 'Pause…');
    await tick(2);
    await delayed.finish({ type: 'failure', status: 403, data: { pauseResult: { ok: false, workerId: 'w1', message: 'You can’t pause or unpause this worker.' } } });
    await tick(2);
    expect(target.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
  });

  it('a delayed answer after the SAME worker’s dialog was reopened is also ignored by the new dialog', async () => {
    const target = await mountStaff([worker({})]);
    pick(target, 'Ada', 'Pause…');
    await tick(2);
    const first = target.querySelector<HTMLFormElement>('[role="dialog"] form')!;
    const delayed = await submitEnhancedDeferred(first);
    target.querySelector<HTMLButtonElement>('[role="dialog"] button[type="button"]')!.click();
    flushSync();
    pick(target, 'Ada', 'Pause…');
    await tick(2);
    await delayed.finish({ type: 'failure', status: 500, data: { pauseResult: { ok: false, workerId: 'w1', message: 'Could not change the pause.' } } });
    await tick(2);
    expect(target.querySelector('[role="dialog"]')).not.toBeNull();
    expect(target.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
  });

  // portal#1067 — who each worker reports to, next to last activity.
  function columnTexts(target: HTMLElement, header: string): string[] {
    const ths = [...target.querySelectorAll('thead th')];
    const idx = ths.findIndex((th) => th.textContent?.trim().startsWith(header));
    if (idx < 0) throw new Error(`no ${header} column`);
    return [...target.querySelectorAll('tbody tr')].map((tr) => tr.children[idx]?.textContent?.trim() ?? '');
  }
  function names(target: HTMLElement): string[] {
    return [...target.querySelectorAll<HTMLAnchorElement>('tbody a[href^="/app/workers/"]')]
      .filter((a) => !a.closest('td')?.previousElementSibling)
      .map((a) => a.textContent!.trim());
  }

  it('shows who each worker reports to, linked, with a retired target flagged', async () => {
    const target = await mountStaff([
      worker({ id: 'w1', name: 'Ada', reportsToWorkerId: null, reportsToRetired: false }),
      worker({ id: 'w2', name: 'Bo', urn: 'hrn:worker:acme.com:team:bo', reportsToWorkerId: 'w1', reportsToRetired: false }),
      worker({ id: 'w3', name: 'Cy', urn: 'hrn:worker:acme.com:team:cy', reportsToWorkerId: 'w4', reportsToRetired: true }),
      worker({ id: 'w4', name: 'Dee', urn: 'hrn:worker:acme.com:team:dee', retiredAt: '2026-09-01T00:00:00.000Z' }),
    ]);
    expect(columnTexts(target, 'Reports to')).toEqual(['—', 'Ada', 'Dee (retired)', '—']);
    const boRow = target.querySelector('a[href="/app/workers/w2"]')!.closest('tr')!;
    expect(boRow.querySelectorAll('a[href="/app/workers/w1"]').length).toBe(1);
  });

  it('sorting by Reports to groups workers under their target, unassigned at the top level', async () => {
    const target = await mountStaff([
      worker({ id: 'w1', name: 'Ada', reportsToWorkerId: null }),
      worker({ id: 'w2', name: 'Bo', urn: 'hrn:worker:acme.com:team:bo', reportsToWorkerId: 'w5' }),
      worker({ id: 'w3', name: 'Cy', urn: 'hrn:worker:acme.com:team:cy', reportsToWorkerId: 'w1', heldByUserId: null, heldAt: null }),
      worker({ id: 'w4', name: 'Dee', urn: 'hrn:worker:acme.com:team:dee', reportsToWorkerId: 'w1' }),
      worker({ id: 'w5', name: 'Eve', urn: 'hrn:worker:acme.com:team:eve', reportsToWorkerId: null }),
    ]);
    const header = [...target.querySelectorAll<HTMLElement>('thead th')].find((th) => th.textContent?.trim().startsWith('Reports to'))!;
    header.querySelector<HTMLElement>('button, [role="button"]')?.click() ?? header.click();
    flushSync();
    // Cy holds no name (no session bound): it still sits under its target.
    expect(columnTexts(target, 'Reports to')).toEqual(['—', '—', 'Ada', 'Ada', 'Eve']);
    expect(names(target)).toEqual(['Ada', 'Eve', 'Cy', 'Dee', 'Bo']);
  });

  it('a Last active column renders the date, and absence as a dash', async () => {
    const target = await mountStaff([
      worker({ id: 'w1', name: 'Ada', lastActiveAt: '2026-10-14T10:00:00.000Z' }),
      worker({ id: 'w2', name: 'Bo', urn: 'hrn:worker:acme.com:team:bo', lastActiveAt: null }),
    ]);
    const cells = columnTexts(target, 'Last active');
    expect(cells[0]).not.toBe('—');
    expect(cells[0]).toMatch(/2026/);
    expect(cells[1]).toBe('—');
  });

  it('sorting by Last active orders by instant, not by wall clock', async () => {
    // Bo's 23:00+02:00 is 21:00Z, an hour BEFORE Ada's 22:00Z; a raw-string
    // accessor gets TanStack's offset-blind alphanumeric sort and puts Bo last
    // (hrn:node:hadronmemory.com:hadron-portal:review:date-column-sorts-by-instant).
    const target = await mountStaff([
      worker({ id: 'w1', name: 'Ada', lastActiveAt: '2026-07-30T22:00:00Z' }),
      worker({ id: 'w2', name: 'Bo', urn: 'hrn:worker:acme.com:team:bo', lastActiveAt: '2026-07-30T23:00:00+02:00' }),
    ]);
    const header = [...target.querySelectorAll<HTMLElement>('thead th')].find((th) => th.textContent?.trim().startsWith('Last active'))!;
    header.querySelector<HTMLElement>('button, [role="button"]')?.click() ?? header.click();
    flushSync();
    // TanStack opens a NUMERIC column descending and a string one ascending,
    // so read the direction rather than assume it: either way, the order must
    // be chronological in the direction the header announces.
    const dir = header.getAttribute('aria-sort');
    expect(dir === 'ascending' || dir === 'descending').toBe(true);
    expect(names(target)).toEqual(dir === 'ascending' ? ['Bo', 'Ada'] : ['Ada', 'Bo']);
  });

  it('a retired worker keeps only the links: nothing to edit, release or retire', async () => {
    const target = await mountStaff([worker({ id: 'w4', name: 'Dee', retiredAt: '2026-09-01T00:00:00.000Z' })]);
    expect(menuOf(target, 'Dee').map(([l]) => l)).toEqual(['Open working memory', 'Open system memory', 'Open role agent']);
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
    return { ...data, initialTab, appKeys: { kind: 'ok', keys: [key] } };
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

// portal#1099 — the App Keys tab's Scopes column (hrn:node:hadronmemory.com:specs:cor:aut:010:03). Read-only,
// and present only when the server answered the manager-only scopes read.
describe('App Keys Scopes column (portal#1099)', () => {
  const key = {
    id: 'k1', label: 'router', keyPreview: 'hk_ab…yz',
    createdAt: '2026-10-01T12:00:00.000Z', lastUsedAt: null, revokedAt: null,
  };
  async function mountKeys(keyScopes: unknown) {
    setStubPage('https://example.test/app/apps/a1?tab=keys', { appId: 'a1' });
    const data = await pageData();
    const props = reactiveProps({ data: { ...data, initialTab: 'keys', appKeys: { kind: 'ok', keys: [key] }, keyScopes }, form: null });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    return m.target.querySelector('#panel-keys')!;
  }
  const headers = (panel: Element) => [...panel.querySelectorAll('th')].map((th) => th.textContent?.trim() ?? '');

  it('a manager sees each key’s scopes, a host scope with its host', async () => {
    const panel = await mountKeys({ kind: 'ok', byKey: { k1: [{ scope: 'attention:deliver', hostId: null, grantedAt: 'x' }, { scope: 'host:operate', hostId: 'h-1', grantedAt: 'x' }] } });
    expect(headers(panel).some((h) => h.startsWith('Scopes'))).toBe(true);
    const chips = [...panel.querySelectorAll('[data-testid="key-scopes"] span')].map((s) => s.textContent?.trim());
    expect(chips).toEqual(['attention:deliver', 'host:operate · h-1']);
  });

  it('a key with no scopes reads None, not an empty chip', async () => {
    const panel = await mountKeys({ kind: 'ok', byKey: { k1: [] } });
    expect(panel.querySelector('[data-testid="key-scopes"]')).toBeNull();
    expect(panel.textContent).toContain('None');
  });

  it('for anyone the server refused (not a manager), there is no Scopes column at all', async () => {
    const panel = await mountKeys({ kind: 'hidden' });
    expect(headers(panel).some((h) => h.startsWith('Scopes'))).toBe(false);
    expect(panel.textContent).toContain('router');
  });

  it('a failed scopes read says so and keeps the keys', async () => {
    const panel = await mountKeys({ kind: 'failed' });
    expect(panel.textContent).toContain('Couldn’t load what these keys may do');
    expect(headers(panel).some((h) => h.startsWith('Scopes'))).toBe(false);
    expect(panel.textContent).toContain('router');
  });

  it('offers no scope write', async () => {
    const panel = await mountKeys({ kind: 'ok', byKey: { k1: [] } });
    expect(panel.textContent).not.toMatch(/Give scope|Take scope back/);
  });
});

// portal#1068 — the key inventory is its own classified read (hadron-server#2080
// made App.keys manager-only). A non-manager is told who may see the keys, a
// failed read is not "No keys yet.", and neither leaks a count or a zero.
describe('App key inventory states (portal#1068)', () => {
  const HIDDEN = 'Only the App’s managers can see its keys.';
  const FAILED = 'Couldn’t load this App’s keys.';
  const key = {
    id: 'k1', label: 'router', keyPreview: 'hk_ab…yz',
    createdAt: '2026-10-01T12:00:00.000Z', lastUsedAt: null, revokedAt: null,
  };
  async function mountTab(tab: 'keys' | 'client', appKeys: unknown) {
    setStubPage(`https://example.test/app/apps/a1?tab=${tab}`, { appId: 'a1' });
    const data = await pageData();
    const m = mountComponent(Page as never, reactiveProps({ data: { ...data, initialTab: tab, appKeys, keyScopes: { kind: 'hidden' } }, form: null }) as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    return m.target.querySelector(`#panel-${tab}`)!;
  }
  it.each(['keys', 'client'] as const)('%s tab: a manager with keys sees them and no refusal copy', async (tab) => {
    const panel = await mountTab(tab, { kind: 'ok', keys: [key] });
    expect(panel.textContent).toContain('router');
    expect(panel.textContent).not.toContain(HIDDEN);
    expect(panel.textContent).not.toContain(FAILED);
  });
  it('keys tab: ok with no keys says "No keys yet."', async () => {
    const panel = await mountTab('keys', { kind: 'ok', keys: [] });
    expect(panel.textContent).toContain('No keys yet.');
  });
  it.each(['keys', 'client'] as const)('%s tab: hidden names who may see keys, never "No keys yet." or a count', async (tab) => {
    const panel = await mountTab(tab, { kind: 'hidden' });
    expect(panel.textContent).toContain(HIDDEN);
    expect(panel.textContent).not.toContain('No keys yet.');
    expect(panel.textContent).not.toContain('No active keys');
    expect(panel.textContent).not.toMatch(/Client Keys\s*\(0\)/);
  });
  it.each(['keys', 'client'] as const)('%s tab: failed says so and is not "No keys yet."', async (tab) => {
    const panel = await mountTab(tab, { kind: 'failed' });
    expect(panel.textContent).toContain(FAILED);
    expect(panel.textContent).not.toContain('No keys yet.');
    expect(panel.textContent).not.toContain('No active keys');
  });
});

// portal#1148 (hadron-server#2089): a roster the server WITHHOLDS (null) is not an empty roster,
// not a failed fetch, and not "no agent". Each known-empty control keeps its existing copy.
describe('withheld App rosters (portal#1148)', () => {
  const agent = { id: 'ag1', urn: 'hrn:agent:acme.com:coordinator', name: 'Coordinator', personaRole: 'coordinator' };
  async function mountTab(tab: string, appOver: Record<string, unknown>, dataOver: Record<string, unknown> = {}) {
    setStubPage(`https://example.test/app/apps/a1?tab=${tab}`, { appId: 'a1' });
    const data = await pageData();
    const memberForms = {
      addMemberForm: await superValidate(zod4(addAppMemberSchema), { errors: false }),
      ensureMemberForm: await superValidate(zod4(ensureAppMemberSchema), { errors: false }),
      removeMemberForm: await superValidate(zod4(removeAppMemberSchema), { errors: false }),
    };
    const m = mountComponent(Page as never, reactiveProps({
      data: { ...data, ...memberForms, initialTab: tab, app: { ...data.app, ...appOver }, ...dataOver }, form: null,
    }) as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    return m.target.querySelector(`#panel-${tab}`)!;
  }
  const WITHHELD_AGENTS = 'The agents installed in this App aren’t visible to you.';

  it('Agents tab: null agents says withheld, never "No agents are installed", and offers no add', async () => {
    const panel = await mountTab('agents', { agents: null });
    expect(panel.textContent).toContain(WITHHELD_AGENTS);
    expect(panel.textContent).not.toContain('No agents are installed in this App yet.');
    expect(panel.querySelector('form[action="?/addAgent"]')).toBeNull();
  });
  it('Agents tab: known-empty control — [] keeps "No agents are installed"', async () => {
    const panel = await mountTab('agents', { agents: [] });
    expect(panel.textContent).toContain('No agents are installed in this App yet.');
    expect(panel.textContent).not.toContain(WITHHELD_AGENTS);
  });
  it('AI Team tab: null agents never claims there is nothing to cast', async () => {
    const panel = await mountTab('staff', { agents: null });
    expect(panel.textContent).toContain('who can be cast here isn’t known');
    expect(panel.textContent).not.toContain('No agents are installed in this App yet, so there is nothing to cast');
  });
  it('AI Team tab: known-empty control — [] keeps the nothing-to-cast copy', async () => {
    const panel = await mountTab('staff', { agents: [] });
    expect(panel.textContent).toContain('nothing to cast');
  });

  it('Human Team: withheld members say so — not "No members yet.", not a failed fetch, no count, no add form', async () => {
    const panel = await mountTab('members', { agent: { id: 'ag1', name: 'Coordinator', installationPolicy: { maxMembers: 'unlimited', memberRoles: ['member'] } }, agents: [agent] }, { members: [], membersError: false, membersWithheld: true });
    expect(panel.textContent).toContain('The members of this App aren’t visible to you.');
    expect(panel.textContent).not.toContain('No members yet.');
    expect(panel.textContent).not.toContain('could not be loaded');
    expect(panel.textContent).not.toMatch(/Human Team\s*\(0/);
    expect(panel.textContent).not.toContain('Add member');
  });
  it('Human Team: known-empty control — an authorized owner with [] still sees "No members yet."', async () => {
    const panel = await mountTab('members', { agents: [agent] }, { members: [], membersError: false, membersWithheld: false });
    expect(panel.textContent).toContain('No members yet.');
    expect(panel.textContent).not.toContain('aren’t visible to you');
  });
  it('Human Team: a failed fetch stays its own state', async () => {
    const panel = await mountTab('members', { agents: [agent] }, { members: [], membersError: true, membersWithheld: false });
    expect(panel.textContent).toContain('could not be loaded');
    expect(panel.textContent).not.toContain('aren’t visible to you');
  });
  it('Human Team: a null agent with a withheld roster does not claim "no Agent linked"', async () => {
    const panel = await mountTab('members', { agent: null, agentId: null, agents: null }, { members: [], membersError: false, membersWithheld: true });
    expect(panel.textContent).not.toContain('This App has no Agent linked yet');
    expect(panel.textContent).toContain('Which Agent is linked to this App isn’t visible to you.');
  });
  it('Human Team: known-empty control — a null agent with a real [] roster still says no Agent is linked', async () => {
    const panel = await mountTab('members', { agent: null, agentId: null, agents: [] }, { members: [], membersError: false, membersWithheld: false });
    expect(panel.textContent).toContain('This App has no Agent linked yet');
  });

  it('Chats tab: null agentId + null agents is withheld, not "Link a chatbot agent"', async () => {
    const panel = await mountTab('chats', { surfaces: ['chat'], agentId: null, agent: null, agents: null }, { chatConfigs: [], selectedChatKey: AGENT_CHAT_KEY });
    expect(panel.textContent).toContain('isn’t visible to you, so agent chat isn’t available here');
    expect(panel.textContent).not.toContain('Link a chatbot agent to enable agent chat');
  });
  it('Chats tab: known-empty control — null agentId + [] still says link a chatbot agent', async () => {
    const panel = await mountTab('chats', { surfaces: ['chat'], agentId: null, agent: null, agents: [] }, { chatConfigs: [], selectedChatKey: AGENT_CHAT_KEY });
    expect(panel.textContent).toContain('Link a chatbot agent to enable agent chat');
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
  const MANAGERS_ONLY = 'Only people who manage this App can create or revoke its keys: its owners and, for an organization’s App, that organization’s owners and admins.';

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

  it('a body with no error text falls back to the generic copy, inline (unchanged by #1106)', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const target = await mountClient(async () => new Response('gateway', { status: 502 }));
    downloadButton(target).click();
    await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).not.toBeNull());
    const alertEl = [...target.querySelectorAll('[role="alert"]')].find((el) => el.textContent?.includes('Failed to create client key.'));
    expect(alertEl).toBeTruthy();
  });
});

// portal#1106 — the Client tab's plugin checkboxes auto-submit updateApp on
// every tick. A viewer the server says cannot manage the App gets them
// read-only: no tick mutates, and none reaches the server to come back as a
// refusal. Pinned in both directions, plus the unknown case, which keeps the
// controls because the server, not the page, is the gate.
describe('Client tab: the plugin grid follows canManageApp (#1106)', () => {
  async function mountClient(canManageApp: boolean | null) {
    setStubPage('https://example.test/app/apps/a1?tab=client', { appId: 'a1' });
    window.history.replaceState({}, '', '/app/apps/a1?tab=client');
    const data = await pageData();
    const m = mountComponent(Page as never, {
      data: { ...data, app: { ...data.app, agentTools: ['CLAUDE_CODE'] }, initialTab: 'client', canManageApp },
      form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    return m.target;
  }
  const boxes = (target: HTMLElement) =>
    [...target.querySelectorAll<HTMLInputElement>('form[action="?/updateAgentTools"] input[type="checkbox"]')];
  const settle = () => new Promise((r) => setTimeout(r, 5));

  it('a non-manager’s boxes are disabled and a tick submits nothing', async () => {
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountClient(false);
    const all = boxes(target);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((b) => b.disabled)).toBe(true);
    // Both the element's own click and a raw dispatched event: the second
    // reaches the handler even where a disabled control drops the first.
    all[1].click();
    all[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(all[0].checked).toBe(true);
    expect(target.textContent).toContain('Only people who manage this App can change its plugins');
  });

  it('a manager’s tick still saves', async () => {
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountClient(true);
    const all = boxes(target);
    expect(all.some((b) => b.disabled)).toBe(false);
    all[1].click();
    await settle();
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    expect(target.textContent).not.toContain('Only people who manage this App can change its plugins');
  });

  it('an unknown answer keeps the controls; the server stays the gate', async () => {
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountClient(null);
    const all = boxes(target);
    expect(all.some((b) => b.disabled)).toBe(false);
    all[1].click();
    await settle();
    expect(requestSubmit).toHaveBeenCalledTimes(1);
  });
});


describe('registered Channel chat switching (#1033)', () => {
  it('isolates messages, late polls, form targets and drafts, using a dropdown', async () => {
    setStubPage('http://localhost/app/apps/a1?tab=chats&chat=room-a', { appId: 'a1' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    let release!: (response: Response) => void;
    const fetcher = vi.fn((url: string) => new Promise<Response>(resolve => { release = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    vi.useFakeTimers();
    const base = await pageData();
    const room = async (id: string) => ({ ...base,
      appChats: [{ key: 'room-a', label: 'A' }, { key: 'room-b', label: 'B' }],
      selectedChatKey: id, selectedChannelId: id, chatsCapped: id === 'room-a', chatRootsShown: 200,
      selectedChannelMessages: [{ ...message(1, 'w1'), body: `message ${id}` }], selectedChannelTotal: 1, selectedChannelError: false,
      postChannelMessageForm: await superValidate({ channelRef: id }, zod4(postTeamChatMessageSchema), { id: `channel:${id}`, errors: false }),
    });
    const a = await room('room-a');
    const b = await room('room-b');
    const props = reactiveProps<Record<string, unknown>>({ data: a, form: null });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    expect(m.target.querySelectorAll('#app-chat-select option')).toHaveLength(2);
    expect(m.target.textContent).toContain('Showing the first 200 chats');
    const body = m.target.querySelector<HTMLTextAreaElement>('textarea[name=body]')!;
    body.value = 'draft for A';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const scroll = m.target.querySelector<HTMLElement>('.overscroll-y-contain')!;
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 100 });
    scroll.scrollTop = 340;
    scroll.dispatchEvent(new Event('scroll'));
    flushSync();
    flushSync(() => { props.data = b; });
    await tick(2);
    expect(m.target.querySelector<HTMLInputElement>('input[name=channelRef]')!.value).toBe('room-b');
    expect(m.target.querySelector<HTMLTextAreaElement>('textarea[name=body]')!.value).toBe('');
    expect(m.target.textContent).toContain('message room-b');
    expect(m.target.textContent).not.toContain('Showing the first 200 chats');
    expect(m.target.textContent).not.toContain('message room-a');
    await vi.advanceTimersByTimeAsync(8000);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('channelRef=room-b&sinceSeq=1'));
    flushSync(() => { props.data = a; });
    await tick(2);
    release(new Response(JSON.stringify({ items: [{ ...message(2, 'w1'), body: 'late room B' }], total: 1, loadFailed: false })));
    await tick(3);
    expect(m.target.querySelector<HTMLTextAreaElement>('textarea[name=body]')!.value).toBe('draft for A');
    expect(m.target.textContent).not.toContain('late room B');
    expect(m.target.querySelector<HTMLElement>('.overscroll-y-contain')!.scrollTop).toBe(340);
    expect(m.target.querySelector<HTMLInputElement>('input[name=channelRef]')!.value).toBe('room-a');
  });
});


it('keeps the default team draft separate when visiting another registered Channel', async () => {
  setStubPage('http://localhost/app/apps/a1?tab=chats', { appId: 'a1' });
  const team = await pageData();
  const other = { ...team, selectedChatKey: 'other', selectedChannelId: 'other', selectedChannelMessages: [],
    selectedChannelTotal: 0, selectedChannelError: false,
    postChannelMessageForm: await superValidate({ channelRef: 'other' }, zod4(postTeamChatMessageSchema), { errors: false, id: 'channel:other' }),
  };
  const props = reactiveProps<Record<string, unknown>>({ data: team, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  let textarea = m.target.querySelector<HTMLTextAreaElement>('textarea[name=body]')!;
  textarea.value = 'team draft';
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync(() => { props.data = other; });
  await tick(2);
  textarea = m.target.querySelector<HTMLTextAreaElement>('textarea[name=body]')!;
  expect(textarea.value).toBe('');
  textarea.value = 'other draft';
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync(() => { props.data = team; });
  await tick(2);
  expect(m.target.querySelector<HTMLTextAreaElement>('textarea[name=body]')!.value).toBe('team draft');
});


it('preserves a cached draft when the real page store seeds the remounted form', async () => {
  setStubPage('http://localhost/app/apps/a1?tab=chats', { appId: 'a1' });
  const team = await pageData();
  const other = { ...team, selectedChatKey: 'other', selectedChannelId: 'other', selectedChannelMessages: [],
    selectedChannelTotal: 0, selectedChannelError: false,
    postChannelMessageForm: await superValidate({ channelRef: 'other' }, zod4(postTeamChatMessageSchema), { errors: false, id: 'channel:other' }),
  };
  page.update((p) => ({ ...p, data: team }));
  const props = reactiveProps<Record<string, unknown>>({ data: team, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  for (const [current, next, body] of [[team, other, 'team draft'], [other, team, 'channel draft']] as const) {
    const textarea = m.target.querySelector<HTMLTextAreaElement>('textarea[name=body]')!;
    textarea.value = body;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    page.update((p) => ({ ...p, data: next }));
    flushSync(() => { props.data = next; });
    await tick(2);
    page.update((p) => ({ ...p, data: current }));
    flushSync(() => { props.data = current; });
    await tick(2);
    expect(m.target.querySelector<HTMLTextAreaElement>('textarea[name=body]')!.value).toBe(body);
    page.update((p) => ({ ...p, data: next }));
    flushSync(() => { props.data = next; });
    await tick(2);
  }
});

it.each([true, false])('keeps a pending Channel post mounted through tab changes and settles success=%s', async (success) => {
  setStubPage('http://localhost/app/apps/a1?tab=chats', { appId: 'a1' });
  const base = await pageData();
  const data = { ...base, selectedChatKey: 'other', selectedChannelId: 'other', selectedChannelMessages: [],
    selectedChannelTotal: 0, selectedChannelError: false,
    postChannelMessageForm: await superValidate({ channelRef: 'other' }, zod4(postTeamChatMessageSchema), { errors: false, id: 'channel:other' }),
  };
  const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  const textarea = m.target.querySelector<HTMLTextAreaElement>('textarea[name=body]')!;
  textarea.value = 'pending post';
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  const form = textarea.closest('form')!;
  const result = await superValidate({ body: 'pending post', channelRef: 'other' }, zod4(postTeamChatMessageSchema), { id: 'channel:other', errors: false });
  result.valid = success;
  result.message = success ? { type: 'success', text: 'Posted.' } : { type: 'error', text: 'Refused; try again.' };
  await submitEnhancedWithResult(form, { type: success ? 'success' : 'failure', status: success ? 200 : 400, data: { form: result } }, async () => {
    await tick(2);
    m.target.querySelector<HTMLButtonElement>('#tab-worklog')!.click();
    flushSync();
    expect(m.target.querySelector('textarea[name=body]')).toBe(textarea);
    m.target.querySelector<HTMLButtonElement>('#tab-chats')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await tick(2);
    expect(m.target.querySelector('textarea[name=body]')).toBe(textarea);
    expect((await submitEnhanced(form)).cancelled).toBe(true);
  });
  await tick(3);
  expect(textarea.value).toBe(success ? '' : 'pending post');
  m.target.querySelector<HTMLButtonElement>('#tab-worklog')!.click();
  flushSync();
  expect(m.target.querySelector('textarea[name=body]')).toBeNull();
  m.target.querySelector<HTMLButtonElement>('#tab-chats')!.click();
  await tick(2);
  const restored = m.target.querySelector<HTMLTextAreaElement>('textarea[name=body]')!;
  expect(restored.value).toBe(success ? '' : 'pending post');
  if (!success) expect((await submitEnhanced(restored.closest('form')!)).cancelled).toBe(false);

});
