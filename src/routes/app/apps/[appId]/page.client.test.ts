/** Mounted App-page coverage for team chat roster reactivity (#979). */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { page, setStubPage } from '$lib/test/stubs/app-stores';
import { navigationCalls, navigationHooks, navigationGuards, resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { kitAppliedResults, resetKitAppliedResults, submitEnhanced, submitEnhancedWithResult, submitEnhancedWithRawResult, submitEnhancedDeferred } from '$lib/test/stubs/app-forms';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
import type { TeamChatFilter } from '$lib/team-chat-filter';
import type { TeamChatMessage, TeamChatRefusal } from '$lib/types';
import { AGENT_CHAT_KEY } from '$lib/app-chats';
import Page from './+page.svelte';
import { resetAiConfigRecoveryForTests } from '$lib/components/ai-config-recovery';
import { message, pageData, runsPanel } from './app-page.fixture';
import {
  createAppMemorySchema, addAgentSchema, castWorkerSchema, removeAppAgentSchema,
  revokeAppKeySchema, grantAppKeyScopeSchema, addAppMemberSchema, ensureAppMemberSchema, removeAppMemberSchema,
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
  resetKitAppliedResults();
  resetAiConfigRecoveryForTests();
  window.history.replaceState({}, '', '/');
});

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

describe('App team chat team filter (#1137)', () => {
  const tagged = (seq: number): TeamChatMessage => ({ ...message(seq, 'w1'), teamTags: [{ headId: 'head-ada', label: 'team.ada' }] });

  it('carries the filter on every poll read, and a chip click navigates to ?team= keeping the other params', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=chats&team=head-ada', { appId: 'a1' });
    window.history.replaceState({}, '', '/app/apps/a1?tab=chats&team=head-ada');
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url);
      if (url.includes('/team-chat/authors')) return { ok: true, json: async () => ({ workers: [], loadFailed: false }) } as Response;
      return { ok: true, json: async () => ({ items: [], total: 0, loadFailed: false }) } as Response;
    }));
    vi.useFakeTimers();
    const data = { ...(await pageData()), teamChatMessages: [tagged(1)], teamFilter: { kind: 'teams', headRefs: ['head-ada'] } as TeamChatFilter };
    const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    await vi.advanceTimersByTimeAsync(8000);
    await tick(3);
    expect(requests.filter((u) => u.includes('sinceSeq'))).toEqual(['/app/apps/a1/team-chat?sinceSeq=1&team=head-ada']);

    const untagged = Array.from(m.target.querySelectorAll('[data-testid="team-chat-filter"] button')).find((b) => b.textContent?.includes('No team tag recorded')) as HTMLButtonElement;
    untagged.click();
    const call = navigationCalls.findLast((c) => c.fn === 'goto')!;
    const url = call.args[0] as URL;
    expect([url.searchParams.get('tab'), url.searchParams.get('team')]).toEqual(['chats', 'untagged']);
    expect(call.args[1]).toMatchObject({ keepFocus: true, noScroll: true });
  });

  it('carries a multi-head selection on every poll read, and a second chip toggles it into the URL (#1482)', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=chats&team=head-ada&team=head-bo', { appId: 'a1' });
    window.history.replaceState({}, '', '/app/apps/a1?tab=chats&team=head-ada&team=head-bo');
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url);
      if (url.includes('/team-chat/authors')) return { ok: true, json: async () => ({ workers: [], loadFailed: false }) } as Response;
      return { ok: true, json: async () => ({ items: [], total: 0, loadFailed: false }) } as Response;
    }));
    vi.useFakeTimers();
    const taggedAda = tagged(1);
    const taggedBo: TeamChatMessage = { ...message(2, 'w1'), teamTags: [{ headId: 'head-bo', label: 'team.bo' }] };
    const data = { ...(await pageData()), teamChatMessages: [taggedAda, taggedBo], teamFilter: { kind: 'teams', headRefs: ['head-ada', 'head-bo'] } as TeamChatFilter };
    const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    await vi.advanceTimersByTimeAsync(8000);
    await tick(3);
    expect(requests.filter((u) => u.includes('sinceSeq'))).toEqual(['/app/apps/a1/team-chat?sinceSeq=2&team=head-ada&team=head-bo']);

    // Toggling one head off asks for the smaller set, keeping the other params.
    const boChip = Array.from(m.target.querySelectorAll('[data-testid="team-chat-tag"]')).find((b) => b.textContent?.includes('team.bo')) as HTMLButtonElement;
    boChip.click();
    const call = navigationCalls.findLast((c) => c.fn === 'goto')!;
    const url = call.args[0] as URL;
    expect(url.searchParams.getAll('team')).toEqual(['head-ada']);
    expect(url.searchParams.get('tab')).toBe('chats');
  });

  it('never reads team-chat while ?team= is malformed (#1137 review)', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=chats&team=%20bad%20', { appId: 'a1' });
    window.history.replaceState({}, '', '/app/apps/a1?tab=chats&team=%20bad%20');
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url);
      if (url.includes('/team-chat/authors')) return { ok: true, json: async () => ({ workers: [], loadFailed: false }) } as Response;
      return { ok: true, json: async () => ({ items: [], total: 0, loadFailed: false }) } as Response;
    }));
    vi.useFakeTimers();
    const data = { ...(await pageData()), teamChatMessages: [], teamChatTotal: 0, teamChatError: true, teamFilter: { kind: 'none' } as TeamChatFilter, teamFilterInvalid: true };
    const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    await vi.advanceTimersByTimeAsync(20000);
    await tick(3);
    expect(requests.filter((u) => u.includes('/team-chat?') || u.endsWith('/team-chat'))).toEqual([]);
    expect(m.target.querySelector('[data-testid="team-chat-filter-invalid"]')).not.toBeNull();
  });

  it('drops a poll that lands after the page moved to another filter', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=chats', { appId: 'a1' });
    window.history.replaceState({}, '', '/app/apps/a1?tab=chats');
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    let release!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/team-chat/authors')) return Promise.resolve({ ok: true, json: async () => ({ workers: [], loadFailed: false }) } as Response);
      return new Promise<Response>((r) => (release = r));
    }));
    vi.useFakeTimers();
    const props = reactiveProps({ data: { ...(await pageData()), teamChatMessages: [tagged(1)], teamFilter: { kind: 'none' } as TeamChatFilter }, form: null });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    await vi.advanceTimersByTimeAsync(8000);
    // The loader answers for ?team=head-bo while the unfiltered poll is in flight.
    props.data = { ...props.data, teamChatMessages: [], teamChatTotal: 0, teamFilter: { kind: 'teams', headRefs: ['head-bo'] } as TeamChatFilter };
    await tick(3);
    release({ ok: true, json: async () => ({ items: [message(2, 'w1')], total: 2, loadFailed: false }) } as Response);
    await vi.advanceTimersByTimeAsync(0);
    await tick(3);
    expect(m.target.textContent).not.toContain('body 2');
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
      ['Delete verified-unused worker', null],
    ]);
  });

  it('someone else’s hold offers Force-release; an unknown hold offers no release at all', async () => {
    const target = await mountStaff([
      worker({ id: 'w2', name: 'Bo', heldByUserId: 'u9' }),
      worker({ id: 'w3', name: 'Cy', heldByUserId: null, heldAt: null }),
    ]);
    expect(menuOf(target, 'Bo').map(([l]) => l)).toContain('Force-release');
    expect(menuOf(target, 'Cy').map(([l]) => l)).toEqual(['Edit', 'Open working memory', 'Open system memory', 'Open role agent', 'Pause…', 'Retire', 'Delete verified-unused worker']);
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

  it.each(['Sample Holder', 'hrn:user:acme.com:sample-holder'])('finds a worker by displayed holder identity: %s (#1168)', async (needle) => {
    const target = await mountStaff([worker({ heldByUserId: 'u9' })], {
      kind: 'ok', byWorker: { w1: entry({ heldBy: {
        id: 'u9', name: 'Sample Holder', handle: 'sample-holder', urn: 'hrn:user:acme.com:sample-holder',
      } }) },
    });
    expect(columnTexts(target, 'Name held by')[0]).toContain('Sample Holder');
    const search = target.querySelector<HTMLInputElement>('input[aria-label="Search worker agents"]')!;
    search.value = needle;
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(2);
    expect(names(target)).toContain('Ada');
  });

  it.each(['self', 'other'])('renders the authorized %s holder name and copyable URN (#1168)', async (kind) => {
    const target = await mountStaff([worker({ heldByUserId: kind === 'self' ? 'u1' : 'u9' })], {
      kind: 'ok', byWorker: { w1: entry({ heldBy: {
        id: kind === 'self' ? 'u1' : 'u9', name: 'Sample Holder', handle: 'sample-holder', urn: 'hrn:user:acme.com:sample-holder',
      } }) },
    });
    const cell = target.querySelector('tbody tr')!;
    expect(columnTexts(target, 'Name held by')[0]).toContain('Sample Holder');
    expect(cell.querySelector('[title="hrn:user:acme.com:sample-holder"]')).not.toBeNull();
  });

  it.each([null, { id: 'u9', name: null, handle: null, urn: null }])('keeps a masked holder unnamed and unsearchable (#1168)', async (holder) => {
    const target = await mountStaff([worker({ heldByUserId: 'u9' })], {
      kind: 'ok', byWorker: { w1: entry({ heldBy: holder }) },
    });
    expect(columnTexts(target, 'Name held by')[0]).toContain('Held by another member');
    expect(target.querySelector('[title="hrn:user:acme.com:sample-holder"]')).toBeNull();
    const search = target.querySelector<HTMLInputElement>('input[aria-label="Search worker agents"]')!;
    search.value = 'Sample Holder';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(2);
    expect(names(target)).toEqual([]);
  });

  it.each([null, undefined])('does not search an undisclosed holder projection (#1168)', async (heldByUserId) => {
    const target = await mountStaff([worker({ heldByUserId })], {
      kind: 'ok', byWorker: { w1: entry({ heldBy: {
        id: 'u9', name: 'Sample Holder', handle: 'sample-holder', urn: 'hrn:user:acme.com:sample-holder',
      } }) },
    });
    expect(columnTexts(target, 'Name held by')[0]).toBe('—');
    const search = target.querySelector<HTMLInputElement>('input[aria-label="Search worker agents"]')!;
    search.value = 'Sample Holder';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(2);
    expect(names(target)).toEqual([]);
  });

  // Greta LOCAL P2 on portal#1375: a current task the loader could not resolve is
  // "Task unavailable": no link, no stale title, unsearchable, and not the "no task" dash.
  it('an unresolved current task is neutral “Task unavailable”, unlinked and unsearchable; a resolved one is found by its handle', async () => {
    const target = await mountStaff(
      [worker({}), worker({ id: 'w2', name: 'Bo', urn: 'hrn:worker:acme.com:team:bo' }), worker({ id: 'w3', name: 'Cy', urn: 'hrn:worker:acme.com:team:cy' })],
      { kind: 'ok', byWorker: {
        w1: entry({ currentTask: { id: 't9', title: 'Ship the grid', status: 'STARTED', handle: 'AT3.405' } }),
        w2: entry({ currentTask: null, currentTaskUnavailable: true }),
        w3: entry(),
      } },
    );
    const tasks = columnTexts(target, 'Task');
    expect(tasks[0]).toContain('AT3.405');
    expect(tasks[1]).toBe('Task unavailable');
    expect(tasks[2]).toBe('—');
    const links = [...target.querySelectorAll('tbody a[href*="/tasks/"]')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/app/apps/a1/tasks/AT3.405']);

    const search = target.querySelector<HTMLInputElement>('input[aria-label="Search worker agents"]')!;
    const names = async (q: string) => {
      search.value = q;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await tick(3);
      return [...target.querySelectorAll('tbody a[href^="/app/workers/"]')].map((a) => a.textContent?.trim());
    };
    expect(await names('AT3.405')).toEqual(['Ada']);
    expect(await names('unavailable')).toEqual([]);
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

  it('a retired worker keeps the verified-unused repair alongside its links', async () => {
    const target = await mountStaff([worker({ id: 'w4', name: 'Dee', retiredAt: '2026-09-01T00:00:00.000Z' })]);
    expect(menuOf(target, 'Dee').map(([l]) => l)).toEqual(['Open working memory', 'Open system memory', 'Open role agent', 'Delete verified-unused worker']);
  });

  // Cody's #1048 QA: the menu CONTENTS were pinned, the DISPATCH was not.
  function pick(target: HTMLElement, name: string, label: string) {
    target.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${name}"]`)!.click();
    flushSync();
    [...target.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find((i) => i.textContent?.trim() === label)!.click();
  }

  it('deletes only the chosen row after an authoritative refresh; a refusal preserves both rows', async () => {
    const oldShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
    const oldClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
    let m: Mounted<Record<string, unknown>> | undefined;
    try {
      setStubPage('https://example.test/app/apps/a1?tab=staff', { appId: 'a1' });
      window.history.replaceState({}, '', '/app/apps/a1?tab=staff');
      const data = await pageData();
      const ada = worker({});
      const bo = worker({ id: 'w2', name: 'Bo', urn: 'hrn:worker:acme.com:team:bo', retiredAt: '2026-09-01T00:00:00.000Z' });
      const props = reactiveProps({ data: { ...data, user: { id: 'u1' }, initialTab: 'staff', staff: [ada, bo], teamRoster: { kind: 'unavailable' } }, form: null });
      m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
      await tick(2);
      pick(m.target, 'Bo', 'Delete verified-unused worker'); await tick();
      const dialog = m.target.querySelector('dialog')!;
      expect(dialog.textContent).toContain('Bo');
      expect(dialog.textContent?.replace(/\s+/g, '')).toContain('hrn:worker:acme.com:team:bo');
      const form = dialog.querySelector('form')!;
      expect(new FormData(form).get('workerRef')).toBe('w2');
      const checkbox = form.querySelector<HTMLInputElement>('input[type=checkbox]')!;
      checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true })); await tick();
      const response = (ok: boolean) => ({ type: ok ? 'success' as const : 'failure' as const, status: ok ? 200 : 400,
        data: { deleteWorkerResult: { ok, workerRef: 'w2', message: 'Retire it instead.', code: 'WORKER_IN_USE' } } });
      await submitEnhancedWithResult(form, response(false)); await tick();
      expect(m.target.querySelector('a[href="/app/workers/w1"]')).not.toBeNull();
      expect(m.target.querySelector('a[href="/app/workers/w2"]')).not.toBeNull();
      expect(dialog.querySelector('[role=alert]')?.textContent).toBe('Retire it instead.');
      navigationHooks.onInvalidateAll = async () => {
        // The old roster remains until the simulated loader response arrives.
        expect(m!.target.querySelector('a[href="/app/workers/w2"]')).not.toBeNull();
        props.data = { ...props.data, staff: [ada] }; await tick();
      };
      await submitEnhancedWithResult(form, response(true)); await tick();
      expect(m.target.querySelector('a[href="/app/workers/w1"]')).not.toBeNull();
      expect(m.target.querySelector('a[href="/app/workers/w2"]')).toBeNull();
    } finally {
      m?.unmount();
      for (const [key, old] of [['showModal', oldShow], ['close', oldClose]] as const) {
        if (old) Object.defineProperty(HTMLDialogElement.prototype, key, old);
        else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
      }
    }
  });

  it.each([
    { name: 'same-App refresh preserves the dialog and pending refusal', changesApp: false },
    { name: 'a different App closes the dialog and discards its late refusal', changesApp: true },
  ])('#1272: $name', async ({ changesApp }) => {
    const oldShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
    const oldClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
    let m: Mounted<Record<string, unknown>> | undefined;
    try {
      setStubPage('https://example.test/app/apps/a1?tab=staff', { appId: 'a1' });
      window.history.replaceState({}, '', '/app/apps/a1?tab=staff');
      const data = await pageData();
      const props = reactiveProps({ data: { ...data, user: { id: 'u1' }, initialTab: 'staff', staff: [worker({})], teamRoster: { kind: 'unavailable' } }, form: null });
      m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
      await tick(2);
      pick(m.target, 'Ada', 'Delete verified-unused worker'); await tick();
      const dialog = m.target.querySelector('dialog')!;
      const form = dialog.querySelector('form')!;
      const checkbox = form.querySelector<HTMLInputElement>('input[type=checkbox]')!;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true })); await tick();
      const pending = await submitEnhancedDeferred(form); await tick();
      expect(dialog.querySelector('[role=status]')?.textContent).toContain('Deleting');

      // SvelteKit replaces the App object on revalidation, even when its ID is unchanged.
      props.data = { ...props.data, app: { ...props.data.app,
        ...(changesApp ? { id: 'a2', urn: 'hrn:app:acme.com:other', name: 'Other App' } : {}),
      } };
      await tick(2);
      if (changesApp) {
        expect(m.target.querySelector('dialog')).toBeNull();
      } else {
        expect(m.target.querySelector('dialog')).toBe(dialog);
        expect(checkbox.checked).toBe(true);
        expect(dialog.querySelector('[role=status]')?.textContent).toContain('Deleting');
        expect((await submitEnhanced(form)).cancelled).toBe(true);
      }
      await pending.finish({ type: 'failure', status: 400, data: {
        deleteWorkerResult: { ok: false, workerRef: 'w1', code: 'WORKER_IN_USE', message: 'Retire it instead.' },
      } });
      await tick(2);
      if (changesApp) {
        expect(m.target.querySelector('dialog')).toBeNull();
        expect(m.target.textContent).not.toContain('Retire it instead.');
      } else {
        expect(m.target.querySelector('dialog')).toBe(dialog);
        expect(dialog.querySelector('[role=alert]')?.textContent).toBe('Retire it instead.');
        expect(dialog.querySelector('[role=status]')).toBeNull();
        expect(new FormData(form).get('workerRef')).toBe('w1');
      }
      expect(m.target.querySelector('a[href="/app/workers/w1"]')).not.toBeNull();
    } finally {
      m?.unmount();
      for (const [key, old] of [['showModal', oldShow], ['close', oldClose]] as const) {
        if (old) Object.defineProperty(HTMLDialogElement.prototype, key, old);
        else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
      }
    }
  });

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

  it('a retired worker without linked objects still offers the server-verified repair', async () => {
    const target = await mountStaff([worker({ id: 'w5', name: 'Eve', retiredAt: '2026-09-01T00:00:00.000Z', memoryId: null, agent: null })]);
    expect(menuOf(target, 'Eve').map(([label]) => label)).toEqual(['Delete verified-unused worker']);
  });

  // portal#1492 (PT1) — a separate, hideable Terminal column: the terminal's own
  // state, never folded into the session Status cell.
  describe('Terminal column (#1492)', () => {
    const PAGE_NOW = '2026-10-31T12:00:00.000Z';
    const term = (over: Record<string, unknown> = {}) => ({ status: 'locked', reason: 'model_at_capacity', checkedAt: '2026-10-31T11:55:00.000Z', ...over });
    const ok = (byWorker: Record<string, unknown>) => ({ kind: 'ok', byWorker });
    async function mountTerminal(staff: unknown[], roster: unknown) {
      setStubPage('https://example.test/app/apps/a1?tab=staff', { appId: 'a1' });
      window.history.replaceState({}, '', '/app/apps/a1?tab=staff');
      const data = await pageData();
      const m = mountComponent(Page as never, {
        data: { ...data, user: { id: 'u1' }, initialTab: 'staff', staff, teamRoster: roster, terminalNow: PAGE_NOW },
        form: null,
      } as never) as Mounted<Record<string, unknown>>;
      mounted.push(m);
      await tick(2);
      return m.target;
    }
    const w = (id: string, name: string, over: Record<string, unknown> = {}) =>
      worker({ id, name, urn: `hrn:worker:acme.com:team:${name.toLowerCase()}`, hasLiveSession: false, ...over });
    function colTexts(target: HTMLElement, header: string): string[] {
      const ths = [...target.querySelectorAll('thead th')];
      const idx = ths.findIndex((th) => th.textContent?.trim().startsWith(header));
      if (idx < 0) throw new Error(`no ${header} column`);
      return [...target.querySelectorAll('tbody tr')].map((tr) => tr.children[idx]?.textContent?.trim() ?? '');
    }
    async function search(target: HTMLElement, q: string): Promise<string[]> {
      const input = target.querySelector<HTMLInputElement>('input[aria-label="Search worker agents"]')!;
      input.value = q;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await tick(3);
      return [...target.querySelectorAll<HTMLAnchorElement>('tbody a[href^="/app/workers/"]')].map((a) => a.textContent!.trim());
    }

    it('is its own column, apart from Status, with each state in words and its age', async () => {
      const target = await mountTerminal(
        [w('w1', 'Ada'), w('w2', 'Bo'), w('w3', 'Cy'), w('w4', 'Dee')],
        ok({
          w1: entry({ terminal: term() }),
          w2: entry({ terminal: term({ status: 'idle', reason: null }) }),
          w3: entry({ terminal: term({ status: 'busy', reason: null }) }),
          w4: entry({ terminal: term({ status: 'dark', reason: 'no_turn_for_due_ticker' }) }),
        }),
      );
      const col = colTexts(target, 'Terminal');
      expect(col[0]).toContain('Locked: Model at capacity');
      expect(col[1]).toContain('Idle');
      expect(col[2]).toContain('Busy');
      expect(col[3]).toContain('Dark: Missed its ticker wake');
      for (const c of col) expect(c).toMatch(/checked .*ago/);
      // The session Status cell is untouched by the terminal.
      expect(colTexts(target, 'Status')).toEqual(Array(4).fill('No recorded activity'));
    });

    it('a returned entry with terminal null is Not reported', async () => {
      const target = await mountTerminal([w('w1', 'Ada')], ok({ w1: entry({ terminal: null }) }));
      expect(colTexts(target, 'Terminal')[0]).toContain('Not reported');
    });

    it('missing entry, failed read and hidden read show no badge, and never Not reported', async () => {
      const missing = await mountTerminal([w('w1', 'Ada'), w('w2', 'Bo')], ok({ w1: entry({ terminal: null }) }));
      const col = colTexts(missing, 'Terminal');
      expect(col[0]).toContain('Not reported');
      expect(col[1]).not.toContain('Not reported');
      expect(col[1]).not.toMatch(/Idle|Busy|Locked|Dark|checked/);
      for (const roster of [{ kind: 'failed' }, { kind: 'hidden' }]) {
        const t2 = await mountTerminal([w('w1', 'Ada')], roster);
        expect(colTexts(t2, 'Terminal')[0]).not.toMatch(/Not reported|Idle|Busy|Locked|Dark|checked/);
      }
    });

    it('a reader without internals sees no badge even if a terminal object arrives, and search finds no hidden value', async () => {
      const target = await mountTerminal(
        [w('w1', 'Ada', { hasLiveSession: null }), w('w2', 'Bo', { hasLiveSession: true })],
        ok({
          w1: entry({ terminal: term({ status: 'dark', reason: 'bare_shell' }) }),
          w2: entry({ terminal: term({ status: 'dark', reason: 'bare_shell' }) }),
        }),
      );
      const col = colTexts(target, 'Terminal');
      expect(col[0]).not.toMatch(/Dark|plain shell|checked/);
      expect(col[1]).toContain('Dark');
      expect(await search(target, 'plain shell')).toEqual(['Bo']);
      expect(await search(target, 'Dark')).toEqual(['Bo']);
    });

    it('#1948 a stale report withholds its server state from the badge and search', async () => {
      const target = await mountTerminal([w('w1', 'Ada')], ok({ w1: entry({ terminal: term({ status: 'busy', reason: null, checkedAt: '2026-10-01T00:00:00.000Z' }) }) }));
      const cell = colTexts(target, 'Terminal')[0];
      expect(cell).toContain('Stale');
      expect(cell).toMatch(/checked .*ago/);
      expect(cell).not.toMatch(/Dark|Idle|Busy/);
      expect(await search(target, 'Busy')).toEqual([]);
      expect(await search(target, 'Stale')).toEqual(['Ada']);
    });

    const staleNote = (target: HTMLElement) => target.querySelectorAll('[data-testid="terminal-stale-note"]');
    it('#1948 all reported rows stale shows one note; unreported and missing rows do not count', async () => {
      const target = await mountTerminal([w('w1','Ada'), w('w2','Bo'), w('w3','Cy')], ok({
        w1: entry({terminal: term({checkedAt:'2026-10-31T04:00:00.000Z'})}), w2: entry({terminal:null}),
      }));
      expect(staleNote(target)).toHaveLength(1);
      expect(staleNote(target)[0].textContent).toMatch(/30 minutes/);
    });
    it.each(['fresh', 'unknown-time'])('#1948 a %s report suppresses the all-stale note', async (kind) => {
      const target = await mountTerminal([w('w1','Ada'),w('w2','Bo')],ok({
        w1:entry({terminal:term({checkedAt:'2026-10-31T04:00:00.000Z'})}),
        w2:entry({terminal:term({checkedAt:kind==='fresh'?'2026-10-31T11:57:00.000Z':null})}),
      }));
      expect(colTexts(target,'Terminal')[0]).toContain('Stale');
      expect(staleNote(target)).toHaveLength(0);
    });
    it('#1948 no report or internals-hidden old report never manufactures an all-stale note', async () => {
      const target=await mountTerminal([w('w1','Ada'),w('w2','Bo',{hasLiveSession:null})],ok({
        w1:entry({terminal:null}),w2:entry({terminal:term({checkedAt:'2026-10-31T04:00:00.000Z'})}),
      }));
      expect(staleNote(target)).toHaveLength(0);
    });
    it('#1948 a clock tick makes stale display, note and active grid search agree', async () => {
      vi.useFakeTimers();
      const target=await mountTerminal([w('w1','Ada')],ok({w1:entry({terminal:term({status:'idle',reason:null,checkedAt:'2026-10-31T11:30:00.000Z'})})}));
      expect(colTexts(target,'Terminal')[0]).toContain('Idle');
      expect(staleNote(target)).toHaveLength(0);
      expect(await search(target,'Idle')).toEqual(['Ada']);
      await vi.advanceTimersByTimeAsync(30_000); await tick(2);
      // No second input event: the active filter must invalidate on the clock tick itself.
      expect(target.querySelectorAll('tbody a[href^="/app/workers/"]')).toHaveLength(0);
      expect(await search(target,'Idle')).toEqual([]);
      expect(await search(target,'Stale')).toEqual(['Ada']);
      expect(colTexts(target,'Terminal')[0]).toContain('Stale');
      expect(staleNote(target)).toHaveLength(1);
    });

    it('a future or unparsable checkedAt is time unknown', async () => {
      const target = await mountTerminal(
        [w('w1', 'Ada'), w('w2', 'Bo')],
        ok({ w1: entry({ terminal: term({ checkedAt: '2026-11-30T00:00:00.000Z' }) }), w2: entry({ terminal: term({ checkedAt: 'garbage' }) }) }),
      );
      const col = colTexts(target, 'Terminal');
      expect(col[0]).toContain('checked: time unknown');
      expect(col[1]).toContain('checked: time unknown');
    });

    // portal#1495 P1 — everything the cell renders must be searchable
    // (hrn:node:hadronmemory.com:hadron-portal:review:everything-the-cell-renders-must-be-searchable):
    // the compact cell renders the summary pill AND the checked age; only the
    // summary was in the accessor, so a reader looking at "checked 5 min. ago"
    // could not find that row by typing what they saw.
    it('the checked age the cell renders is reachable through the real grid filter (portal#1495)', async () => {
      const target = await mountTerminal(
        [w('w1', 'Ada'), w('w2', 'Bo')],
        ok({ w1: entry({ terminal: term() }), w2: entry({ terminal: term({ status: 'idle', reason: null, checkedAt: null }) }) }),
      );
      expect(colTexts(target, 'Terminal')[0]).toContain('checked 5 min. ago');
      expect(await search(target, 'checked 5 min')).toEqual(['Ada']);
      expect(await search(target, 'time unknown')).toEqual(['Bo']);
    });

    it('age text never matches a row that renders none of it (portal#1495 non-disclosure)', async () => {
      const target = await mountTerminal(
        [w('w1', 'Ada'), w('w2', 'Bo'), w('w3', 'Cy'), w('w4', 'Dee', { hasLiveSession: null })],
        ok({
          w1: entry({ terminal: term() }),
          w2: entry({ terminal: null }),
          // SECURITY P3-1 (#1618, Rook): w4 HAS a terminal object, but the
          // reader lacks internals — no badge, no age. Without this row the
          // non-disclosure pin survives a mutant that reads checkedAt straight
          // off the roster entry, bypassing the internals gate.
          w4: entry({ terminal: term() }),
        }),
      );
      // w2 is Not reported (no age line); w3 has no roster entry (no badge at
      // all); w4's terminal is masked by the internals gate.
      expect(await search(target, 'checked')).toEqual(['Ada']);
      expect(await search(target, 'min. ago')).toEqual(['Ada']);
      expect(await search(target, 'Not reported')).toEqual(['Bo']);
    });

    // portal#1495 P3 — the loader's clock is a seed, not a freeze: on an open
    // page the ages advance, the display and the grid filter read the SAME
    // clock, and no request is made to refresh anything.
    it('the age the cell shows and the filter matches advances on an open page (portal#1495)', async () => {
      vi.useFakeTimers();
      const target = await mountTerminal([w('w1', 'Ada')], ok({ w1: entry({ terminal: term() }) }));
      expect(colTexts(target, 'Terminal')[0]).toContain('checked 5 min. ago');
      await vi.advanceTimersByTimeAsync(60_000);
      await tick(2);
      expect(colTexts(target, 'Terminal')[0]).toContain('checked 6 min. ago');
      expect(await search(target, 'checked 6 min')).toEqual(['Ada']);
      expect(await search(target, 'checked 5 min')).toEqual([]);
    });

    // The teardown half of P3: leaving the page stops the clock. The DOM is
    // detached but live in jsdom, so a leaked interval would keep writing to it.
    it('unmounting the page stops the clock: nothing advances after teardown (portal#1495)', async () => {
      vi.useFakeTimers();
      const target = await mountTerminal([w('w1', 'Ada')], ok({ w1: entry({ terminal: term() }) }));
      const ths = [...target.querySelectorAll('thead th')];
      const idx = ths.findIndex((th) => th.textContent?.trim().startsWith('Terminal'));
      const cell = target.querySelector('tbody tr')!.children[idx] as HTMLElement;
      expect(cell.textContent).toContain('checked 5 min. ago');
      mounted.pop()!.unmount();
      await vi.advanceTimersByTimeAsync(300_000);
      await tick(2);
      expect(cell.textContent).toContain('checked 5 min. ago');
    });

    // portal#1495 BLIND P3 (George) — the detached-DOM assertion above cannot
    // detect a leaked interval: Svelte disposes the effects after unmount, so
    // the DOM stays frozen even while the interval keeps ticking the clock
    // state. The fake-timer count is the honest witness — the page schedules
    // exactly one interval (its display clock) and must clear it on unmount,
    // returning to the pre-mount baseline.
    it('unmounting the page clears the clock interval itself, not just its DOM writes (portal#1495 BLIND)', async () => {
      vi.useFakeTimers();
      const baseline = vi.getTimerCount();
      const target = await mountTerminal([w('w1', 'Ada')], ok({ w1: entry({ terminal: term() }) }));
      expect(colTexts(target, 'Terminal')[0]).toContain('checked 5 min. ago');
      expect(vi.getTimerCount()).toBe(baseline + 1); // the one clock interval
      mounted.pop()!.unmount();
      await tick(2);
      expect(vi.getTimerCount()).toBe(baseline);
    });

    // portal#1618 LOCAL P2 (Gemma, on the fold head) — the per-tick row
    // re-bake that makes a tick re-filter (BLIND P2 above) hands the table a
    // fresh data-array reference every 30 s, and TanStack's default
    // autoResetPageIndex read exactly that as "data changed": a >20-worker
    // staff grid bounced to page 1 under a reader who had paged, every tick,
    // silently. The page keeps its page across a tick; a NEW search still
    // starts from page 1 (the page owns that reset once the default is off).
    it('a >20-worker grid keeps its page across a tick, and a new search restarts from page 1 (portal#1618 LOCAL P2)', async () => {
      vi.useFakeTimers();
      const staff = Array.from({ length: 21 }, (_, i) => w(`p${i + 1}`, `Pager${i + 1}`));
      const roster = ok(Object.fromEntries(staff.map((s) => [s.id, entry({ terminal: term() })])));
      const target = await mountTerminal(staff, roster);
      const pageOf = () => target.querySelector('[data-testid="table-footer"] span')!.textContent!;
      const next = [...target.querySelectorAll<HTMLButtonElement>('[data-testid="table-footer"] button')]
        .find((b) => b.textContent?.trim() === 'Next')!;
      next.click();
      flushSync();
      expect(pageOf()).toBe('Page 2 of 2'); // paged past 20 rows
      await vi.advanceTimersByTimeAsync(60_000);
      await tick(3);
      expect(pageOf()).toBe('Page 2 of 2'); // a tick must not steal the page
      await search(target, 'Pager'); // still matches every row, so still 2 pages
      await tick(3);
      expect(pageOf()).toBe('Page 1 of 2'); // a new search restarts at page 1
    });

    // The clamp half of the same fix: with autoResetPageIndex off, nothing
    // resets the page when the DATA shrinks either (the default used to). A
    // reload that drops the roster below the page the reader sits on must
    // land them on the new last page with rows in front of them — not strand
    // them on an empty page 2 with an unreachable footer.
    it('a shrunken roster never strands the reader past the last page (portal#1618 LOCAL P2)', async () => {
      vi.useFakeTimers();
      const staff = Array.from({ length: 21 }, (_, i) => w(`p${i + 1}`, `Pager${i + 1}`));
      setStubPage('https://example.test/app/apps/a1?tab=staff', { appId: 'a1' });
      window.history.replaceState({}, '', '/app/apps/a1?tab=staff');
      const props = reactiveProps({ data: { ...(await pageData()), user: { id: 'u1' }, initialTab: 'staff', staff, teamRoster: ok({}), terminalNow: PAGE_NOW }, form: null });
      const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
      mounted.push(m);
      await tick(2);
      const next = [...m.target.querySelectorAll<HTMLButtonElement>('[data-testid="table-footer"] button')]
        .find((b) => b.textContent?.trim() === 'Next')!;
      next.click();
      flushSync();
      const names = () => [...m.target.querySelectorAll<HTMLAnchorElement>('tbody a[href^="/app/workers/"]')].map((a) => a.textContent!.trim());
      expect(names().length).toBe(1); // page 2 of 2 holds the 21st worker
      props.data = { ...props.data, staff: staff.slice(0, 5) }; await tick(3); // a reload with 5 workers
      expect(names()).toEqual(staff.slice(0, 5).map((s) => s.name)); // rows in front of the reader, not an empty page
    });

    // portal#1495 BLIND P2 (George) — a search left ACTIVE across a tick must
    // re-filter with the advanced clock. The earlier advancing test re-typed
    // the search after the tick, which set new filter state and forced the
    // recompute; a reader who leaves one search open sees the memoized model
    // unless the clock's read inside the filter tracks through the table's
    // row-model atoms. Ada is 5 min at load (11:55), Bo 4 min (11:56); after
    // 60 s Ada is 6 min and Bo 5 min — an untouched `checked 5 min` search
    // must swap which row it shows.
    it('a search left active across a tick follows the advanced clock (portal#1495 BLIND)', async () => {
      vi.useFakeTimers();
      const target = await mountTerminal(
        [w('w1', 'Ada'), w('w2', 'Bo')],
        ok({
          w1: entry({ terminal: term() }),
          w2: entry({ terminal: term({ status: 'idle', reason: null, checkedAt: '2026-10-31T11:56:00.000Z' }) }),
        }),
      );
      const visible = () =>
        [...target.querySelectorAll<HTMLAnchorElement>('tbody a[href^="/app/workers/"]')].map((a) => a.textContent!.trim());
      // Before any search: Ada renders 5 min, Bo 4 min.
      const cells = colTexts(target, 'Terminal').join('|');
      expect(cells).toContain('checked 5 min. ago');
      expect(cells).toContain('checked 4 min. ago');
      expect(await search(target, 'checked 5 min')).toEqual(['Ada']);
      await vi.advanceTimersByTimeAsync(60_000);
      await tick(3);
      // Both cells advanced (Ada→6, Bo→5) and the still-active search follows
      // the clock without being re-typed: Ada (now 6 min) drops out, Bo enters.
      const after = colTexts(target, 'Terminal').join('|');
      expect(after).toContain('checked 5 min. ago');
      expect(after).not.toContain('checked 6 min. ago');
      expect(visible()).toEqual(['Bo']);
    });

    it('an unknown state or reason shows fixed copy, never the raw code, in the page or the console', async () => {
      const spies = (['log', 'warn', 'error', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
      const target = await mountTerminal([w('w1', 'Ada')], ok({ w1: entry({ terminal: term({ status: 'quantum', reason: 'solar_flare' }) }) }));
      const cell = colTexts(target, 'Terminal')[0];
      expect(cell).toContain('Unknown state: Other reason');
      expect(target.textContent).not.toContain('solar_flare');
      expect(target.textContent).not.toContain('quantum');
      for (const s of spies) {
        for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toMatch(/solar_flare|quantum/);
      }
    });

    it('is hideable from the column toggle', async () => {
      const target = await mountTerminal([w('w1', 'Ada')], ok({ w1: entry({ terminal: term() }) }));
      const headers = () => [...target.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
      expect(headers().some((h) => h?.startsWith('Terminal'))).toBe(true);
      // The Columns dropdown's content renders only while open (#1587: the
      // open layer arms the shared Escape fallback on that same `{#if open}`
      // block), so open it before querying its labels. jsdom toggles the
      // `open` attribute but never fires the `toggle` event, so deliver the
      // browser's half of the pair.
      const details = target.querySelector('details')!;
      details.querySelector('summary')!.click();
      details.dispatchEvent(new Event('toggle'));
      flushSync();
      expect(details.open).toBe(true);
      // portal#1495 (BLIND hygiene): startsWith, like the header match above —
      // an icon or count on the label must not break the lookup.
      const box = [...target.querySelectorAll('label')].find((l) => l.textContent?.trim().startsWith('Terminal'))?.querySelector('input');
      expect(box).toBeTruthy();
      box!.click();
      await tick(2);
      expect(headers().some((h) => h?.startsWith('Terminal'))).toBe(false);
    });
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
    expect(configsPanel.textContent).toContain('AI provider configurations');
    expect(configsPanel.textContent).toContain('Owned by Team');
    expect(m.target.querySelector('#panel-keys')).toBeNull();

    (m.target.querySelector('#tab-settings') as HTMLButtonElement).click();
    await tick(2);
    const settingsPanel = m.target.querySelector('#panel-settings')!;
    expect(settingsPanel.textContent).not.toContain('Generate Key');
    expect(settingsPanel.textContent).not.toContain('production-backend');
    expect(settingsPanel.textContent).not.toContain('AI provider configurations');
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
  async function mountKeys(keyScopes: unknown, over: Record<string, unknown> = {}) {
    setStubPage('https://example.test/app/apps/a1?tab=keys', { appId: 'a1' });
    const data = await pageData();
    const props = reactiveProps({ data: { ...data, initialTab: 'keys', appKeys: { kind: 'ok', keys: [key] }, keyScopes, ...over }, form: null });
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

  it('offers no scope write to a reader the server refuses', async () => {
    // portal#1153: a viewer who does not manage the App still sees the keys
    // table, but the whole row menu — Revoke and the portal#1487 grant
    // control with it — is absent, and the withheld line names the audience.
    // The menu BUTTON is the guard (its items are not in the DOM until it
    // opens, so a textContent check would pass vacuously).
    const panel = await mountKeys({ kind: 'hidden' }, { viewerManages: { kind: 'known', manages: false } });
    expect(panel.querySelector('button[aria-label^="Actions for key"]')).toBeNull();
    expect(panel.textContent).toContain('Only people who manage this App can mint, revoke and scope its keys');
  });
});

// portal#1487 — giving a live key one scope of the closed list
// (hrn:node:hadronmemory.com:specs:cor:aut:010:03) from a dialog the row's ⋯ menu opens. The server is the
// gate; every refusal text below is the server's own, shown beside the form.
describe('App key scope grant dialog (portal#1487)', () => {
  const key = {
    id: 'k1', label: 'router', keyPreview: 'hk_ab…yz',
    createdAt: '2026-10-01T12:00:00.000Z', lastUsedAt: null, revokedAt: null,
  };
  // jsdom's <dialog> has no real showModal/close; stub both for this suite
  // (the WorkerDeleteDialog suite's pattern).
  let oldShow: PropertyDescriptor | undefined, oldClose: PropertyDescriptor | undefined;
  beforeAll(() => {
    oldShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
    oldClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
  });
  afterAll(() => {
    for (const [k, old] of [['showModal', oldShow], ['close', oldClose]] as const) {
      if (old) Object.defineProperty(HTMLDialogElement.prototype, k, old);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, k);
    }
  });
  async function mountKeys(keyScopes: unknown = { kind: 'ok', byKey: { k1: [] } }) {
    setStubPage('https://example.test/app/apps/a1?tab=keys', { appId: 'a1' });
    const data = await pageData();
    const m = mountComponent(Page as never, {
      data: { ...data, initialTab: 'keys', appKeys: { kind: 'ok', keys: [key] }, keyScopes },
      form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    // The page root, not #panel-keys: the shared success line sits above the
    // tabs, outside the panel.
    return m.target;
  }
  async function openGrant(panel: Element) {
    (panel.querySelector('button[aria-label^="Actions for key"]') as HTMLButtonElement).click();
    await tick(2);
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.includes('Grant scope')) as HTMLButtonElement | undefined;
    if (!item) throw new Error('no Grant scope menu item');
    item.click();
    await tick(2);
    const dialog = document.querySelector('dialog[open]');
    if (!dialog) throw new Error('the grant dialog did not open');
    return dialog;
  }
  const scopeSelect = (dialog: Element) => dialog.querySelector<HTMLSelectElement>('select[name="scope"]')!;
  const hostInput = (dialog: Element) => dialog.querySelector<HTMLInputElement>('input[name="hostId"]');
  const chooseScope = async (dialog: Element, value: string) => {
    const select = scopeSelect(dialog);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    await tick();
  };
  const grantForm = (dialog: Element) => dialog.querySelector('form')!;
  // A user types into the host field: set the value AND fire the input event,
  // so the bound store carries it. Setting .value alone leaves the store at
  // its reset '' — the local empty-host refusal then cancels the submit and
  // the server's answer below never arrives.
  const typeHost = (dialog: Element, value: string) => {
    const host = hostInput(dialog)!;
    host.value = value;
    host.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  };

  it('opens from the row menu naming the key, with no host field for attention:deliver', async () => {
    const panel = await mountKeys();
    const dialog = await openGrant(panel);
    expect(dialog.getAttribute('aria-labelledby')).toBe('grant-scope-title');
    expect(dialog.textContent).toContain('Grant a scope');
    // The key once: label, preview beneath (an App key has no URN).
    expect(dialog.textContent).toContain('router');
    expect(dialog.textContent).toContain('hk_ab…yz');
    expect(scopeSelect(dialog).value).toBe('attention:deliver');
    expect(hostInput(dialog)).toBeNull();
    expect(grantForm(dialog).getAttribute('action')).toBe('?/grantKeyScope');
    expect(new FormData(grantForm(dialog)).get('keyId')).toBe('k1');
  });

  it('host:operate asks for the host with helper text under the field, and only then', async () => {
    const panel = await mountKeys();
    const dialog = await openGrant(panel);
    await chooseScope(dialog, 'host:operate');
    const host = hostInput(dialog)!;
    expect(host).toBeTruthy();
    // Plain label (no parenthesised instruction), helper text UNDER the field.
    const label = dialog.querySelector('label[for="grant-host"]')!;
    expect(label.textContent?.trim()).toBe('Host');
    const help = document.getElementById('grant-host-help')!;
    expect(help.textContent).toContain('A host key reaches one host.');
    // attention:deliver hides it again — no host argument travels for a
    // scope the server grants without one.
    await chooseScope(dialog, 'attention:deliver');
    expect(hostInput(dialog)).toBeNull();
  });

  it('the host input names its help by id and goes invalid with the error (#1487 review: aria wiring)', async () => {
    const panel = await mountKeys();
    const dialog = await openGrant(panel);
    await chooseScope(dialog, 'host:operate');
    const host = hostInput(dialog)!;
    // Standing state: described-by names the help (looked up by its id, not
    // by DOM position), the input is not invalid, and no alert is showing.
    expect(host.getAttribute('aria-describedby')).toBe('grant-host-help');
    expect(document.getElementById('grant-host-help')?.textContent).toContain('A host key reaches one host.');
    expect(host.getAttribute('aria-invalid')).not.toBe('true');
    expect(document.getElementById('grant-scope-error')).toBeNull();
    // An empty-host submit is refused client-side: the field error marks the
    // input invalid, described-by KEEPS the help and ADDS the alert id, and
    // every named id resolves to a live element in the document.
    host.value = '';
    await submitEnhanced(grantForm(dialog), true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(); await tick(2);
    expect(host.getAttribute('aria-invalid')).toBe('true');
    const describedBy = host.getAttribute('aria-describedby')!.split(/\s+/);
    expect(describedBy).toContain('grant-host-help');
    expect(describedBy).toContain('grant-scope-error');
    for (const id of describedBy) expect(document.getElementById(id), `id ${id} does not resolve`).toBeTruthy();
  });


  it('refuses an empty host in the dialog and sends nothing', async () => {
    const panel = await mountKeys();
    const dialog = await openGrant(panel);
    await chooseScope(dialog, 'host:operate');
    hostInput(dialog)!.value = '';
    const { cancelled } = await submitEnhanced(grantForm(dialog), true);
    expect(cancelled).toBe(true);
    // The local refusal runs through superforms' own failure handling on a
    // setTimeout(0): flush the macrotask before the DOM can show it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(); await tick(2);
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('Name the host this key may operate.');
    // The refused submit also ENDS: the dialog never locks on 'Granting…'.
    const submit = [...dialog.querySelectorAll('button')].find((b) => b.type === 'submit')!;
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toContain('Grant');
  });

  it('a HOST_CONFLICT refusal keeps the dialog open with the server’s own sentence', async () => {
    const serverText = 'This key already operates as host h-1. A host key reaches one host: revoke host:operate first, or use another key.';
    const panel = await mountKeys({ kind: 'ok', byKey: { k1: [{ scope: 'host:operate', hostId: 'h-1', grantedAt: 'x' }] } });
    const dialog = await openGrant(panel);
    await chooseScope(dialog, 'host:operate');
    typeHost(dialog, 'h-2');
    const f = await superValidate({ _kind: 'grantKeyScope', keyId: 'k1', scope: 'host:operate', hostId: 'h-2' }, zod4(grantAppKeyScopeSchema));
    f.message = { type: 'error', text: serverText };
    await submitEnhancedWithResult(grantForm(dialog), { type: 'failure', status: 409, data: { form: f } });
    flushSync(); await tick(2);
    // The refusal sits beside the form that ran; the dialog stays; the held
    // grant (host h-1) is untouched on the tab.
    expect(document.querySelector('dialog[open]')).toBeTruthy();
    expect(dialog.querySelector('[data-testid="grant-scope-error"]')?.textContent).toBe(serverText);
    // It arrived as a form message, not as errors.hostId — the host input is
    // still marked invalid and still names help AND alert (it is the
    // dialog's one free-text field).
    const host = hostInput(dialog)!;
    expect(host.getAttribute('aria-invalid')).toBe('true');
    expect(host.getAttribute('aria-describedby')).toBe('grant-host-help grant-scope-error');
    expect(panel.querySelector('[data-testid="key-scopes"]')?.textContent).toContain('host:operate · h-1');
  });

  it('a success closes the dialog and announces the granted scope', async () => {
    const panel = await mountKeys();
    const dialog = await openGrant(panel);
    const trigBefore = document.querySelector('button[aria-label^="Actions for key"]') as HTMLElement;
    // jsdom's settle path blurs focus set inside a flush (activeElement is
    // <body> by assertion time even when the teardown focused the trigger —
    // the same env blur leaves <body> at the action's mount), so this lane
    // pins the teardown's TARGET by spy; the real-browser focus mechanics
    // are the layout script's Cancel/Escape/keyboard legs.
    const trigFocus = vi.spyOn(trigBefore, 'focus');
    const f = await superValidate({ _kind: 'grantKeyScope', keyId: 'k1', scope: 'attention:deliver', hostId: '' }, zod4(grantAppKeyScopeSchema));
    f.message = { type: 'success', text: 'Scope granted.' };
    await submitEnhancedWithResult(grantForm(dialog), { type: 'success', status: 200, data: { form: f } });
    flushSync(); await tick(2);
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(panel.textContent).toContain('Scope granted.');
    // The success close returns focus to the ⋯ trigger that opened the
    // dialog, whose row still stands here (jsdom does not re-render rows).
    expect(trigFocus).toHaveBeenCalled();
  });

  it('a success whose row is gone lands focus on the Keys heading, never <body>', async () => {
    const panel = await mountKeys();
    const dialog = await openGrant(panel);
    const trigBefore = document.querySelector('button[aria-label^="Actions for key"]') as HTMLElement;
    // The success path invalidates the page and the table re-renders its
    // rows — the captured ⋯ trigger can be detached by the time the dialog
    // unmounts. Stand in for that by removing the row outright.
    const heading = document.getElementById('app-keys-heading')!;
    const trigFocus = vi.spyOn(trigBefore, 'focus');
    const headingFocus = vi.spyOn(heading, 'focus');
    trigBefore.closest('tr')!.remove();
    const f = await superValidate({ _kind: 'grantKeyScope', keyId: 'k1', scope: 'attention:deliver', hostId: '' }, zod4(grantAppKeyScopeSchema));
    f.message = { type: 'success', text: 'Scope granted.' };
    await submitEnhancedWithResult(grantForm(dialog), { type: 'success', status: 200, data: { form: f } });
    flushSync(); await tick(2);
    expect(document.querySelector('dialog[open]')).toBeNull();
    // A detached trigger cannot take focus — the teardown owes the close a
    // landing spot, and it is the Keys heading, never <body>. (Target pinned
    // by spy: the env blurs activeElement after the flush; the real-browser
    // detached-trigger leg is in the layout script.)
    expect(trigFocus).not.toHaveBeenCalled();
    expect(headingFocus).toHaveBeenCalled();
  });

  it('a refusal from an earlier key never reads as this one’s answer', async () => {
    const panel = await mountKeys();
    const dialog = await openGrant(panel);
    await chooseScope(dialog, 'host:operate');
    typeHost(dialog, 'h-2');
    const f = await superValidate({ _kind: 'grantKeyScope', keyId: 'k1', scope: 'host:operate', hostId: 'h-2' }, zod4(grantAppKeyScopeSchema));
    f.message = { type: 'error', text: 'This key already operates as host h-1.' };
    await submitEnhancedWithResult(grantForm(dialog), { type: 'failure', status: 409, data: { form: f } });
    flushSync(); await tick(2);
    expect(dialog.querySelector('[data-testid="grant-scope-error"]')).toBeTruthy();
    // Cancel, reopen: the form is reset for the key — no stale refusal, no
    // stale host.
    (dialog.querySelector('button[type="button"]') as HTMLButtonElement).click();
    flushSync(); await tick(2);
    const reopened = await openGrant(panel);
    expect(reopened.querySelector('[data-testid="grant-scope-error"]')).toBeNull();
    expect(scopeSelect(reopened).value).toBe('attention:deliver');
    expect(hostInput(reopened)).toBeNull();
  });

  // ── review on #1487: the dialog must not lock, and must not leak across Apps ──

  it('a transport failure frees the dialog and says the grant is unconfirmed', async () => {
    const panel = await mountKeys();
    const dialog = await openGrant(panel);
    // Exactly what kit's enhance hands superforms when the fetch rejects.
    await submitEnhancedWithRawResult(grantForm(dialog), { type: 'error', status: 500, error: new Error('boom') });
    flushSync(); await tick(2);
    // The outcome is unknown, so the dialog STAYS and says so beside the form
    // that ran — claiming neither that it landed nor that it was refused.
    expect(document.querySelector('dialog[open]')).toBeTruthy();
    expect(dialog.querySelector('[data-testid="grant-scope-error"]')?.textContent).toContain('could not be confirmed');
    // …and the submit ENDS: no 'Granting…', Cancel usable again. The stuck
    // modal this replaces never cleared $grantKeyScopeSubmitting.
    const submit = [...dialog.querySelectorAll('button')].find((b) => b.type === 'submit')!;
    expect(submit.textContent).toContain('Grant');
    expect(submit.disabled).toBe(false);
    expect([...dialog.querySelectorAll('button')].find((b) => b.textContent?.includes('Cancel'))!.disabled).toBe(false);
  });

  // The page component survives /apps/A -> /apps/B (same route id), and
  // `grantScopeKey` is $state — so the dialog must be fenced to the App it
  // was opened on, or showModal() reopens the departed App's dialog on B's
  // Keys tab and a Grant there would write A's key.
  describe('the open dialog is fenced to one App (#1487 review)', () => {
    const KEY_A = { id: 'k1', label: 'router', keyPreview: 'hk_ab…yz', createdAt: '2026-10-01T12:00:00.000Z', lastUsedAt: null, revokedAt: null };
    const KEY_B = { id: 'k2', label: 'laptop', keyPreview: 'hk_cd…wv', createdAt: '2026-10-02T12:00:00.000Z', lastUsedAt: null, revokedAt: null };
    async function keysDataFor(appId: string, key: typeof KEY_A) {
      setStubPage(`https://example.test/app/apps/${appId}?tab=keys`, { appId });
      const data = await pageData();
      return {
        ...data, initialTab: 'keys', app: { ...data.app, id: appId },
        appKeys: { kind: 'ok', keys: [key] }, keyScopes: { kind: 'ok', byKey: {} },
      };
    }
    async function mountAppKeys() {
      const props = reactiveProps({ data: await keysDataFor('a1', KEY_A), form: null });
      const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
      mounted.push(m);
      await tick(2);
      return { m, props };
    }
    const moveTo = async (props: { data: unknown }, appId: string, key: typeof KEY_A) => {
      props.data = await keysDataFor(appId, key);
      await tick(3);
    };

    it('does not follow the reader onto another App’s Keys tab', async () => {
      const { m, props } = await mountAppKeys();
      await openGrant(m.target);
      expect(document.querySelector('dialog[open]')).toBeTruthy();
      await moveTo(props, 'a2', KEY_B);
      // The dialog for A's key is GONE — not open, not in the DOM at all —
      // and A's key never reads on B's tab.
      expect(document.querySelector('dialog[open]')).toBeNull();
      expect(m.target.querySelector('[data-testid="grant-scope-dialog"]')).toBeNull();
      expect(m.target.textContent).not.toContain('hk_ab…yz');
      // What B offers is B's own key, with a fresh form reset for it.
      const dialog = await openGrant(m.target);
      expect(dialog.textContent).toContain('hk_cd…wv');
      expect(new FormData(grantForm(dialog)).get('keyId')).toBe('k2');
      expect(scopeSelect(dialog).value).toBe('attention:deliver');
    });

    it('A’s late grant answer says nothing on B and refreshes nothing there', async () => {
      const { m, props } = await mountAppKeys();
      const dialog = await openGrant(m.target);
      const delayed = await submitEnhancedDeferred(grantForm(dialog));
      await moveTo(props, 'a2', KEY_B);
      const f = await superValidate({ _kind: 'grantKeyScope', keyId: 'k1', scope: 'attention:deliver', hostId: '' }, zod4(grantAppKeyScopeSchema));
      f.message = { type: 'success', text: 'Scope granted.' };
      await delayed.finish({ type: 'success', status: 200, data: { form: f } });
      flushSync(); await tick(4);
      expect(m.target.textContent).not.toContain('Scope granted.');
      expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
      expect(document.querySelector('dialog[open]')).toBeNull();
    });
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
    // portal#1153: on the Keys tab one combined line replaces the list-hidden line.
    expect(panel.textContent).toContain(tab === 'keys' ? 'Only people who manage this App can see, create or revoke its keys' : HIDDEN);
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

describe('App AI configuration readback lifecycle', () => {
  const masked = {
    id: 'c1', name: 'default', ownerType: 'APP', ownerId: 'a1', provider: 'anthropic', model: 'claude-sonnet-5',
    endpoint: null, effectiveEndpoint: 'https://api.anthropic.com/v1', apiStyle: null, effectiveApiStyle: null,
    hasApiKey: true, apiKeyPreview: '…key', params: null, enabled: true,
    createdAt: '2026-11-08T00:00:00Z', updatedAt: null,
  };

  // portal#1963: the loader's dropdown options (chatAiChoiceOptions output). The value is the config id.
  const choice = (id: string, name: string, over: Record<string, unknown> = {}) => ({
    value: id, name, provider: 'anthropic', model: 'claude-sonnet-5', isDefault: false,
    isAppChatbotConfig: false, unavailableReason: null, ...over,
  });
  const defaultChoice = {
    value: 'default', name: 'default', provider: null, model: null, isDefault: true,
    isAppChatbotConfig: false, unavailableReason: null,
  };
  const optionValues = (target: HTMLElement) =>
    [...target.querySelectorAll<HTMLOptionElement>('#agent-chat-ai-config option')].map((o) => o.value);

  async function mountAi(dataOver: Record<string, unknown> = {}) {
    setStubPage('https://example.test/app/apps/a1?tab=ai-configs', { appId: 'a1' });
    const data = await pageData();
    const m = mountComponent(Page as never, reactiveProps({
      data: {
        ...data,
        aiChoices: [defaultChoice, choice('c1', 'default')],
        ...dataOver,
        initialTab: 'ai-configs', selectedChatKey: AGENT_CHAT_KEY,
        app: {
          ...data.app, surfaces: ['chat'], agentId: 'ag1', agent: { id: 'ag1', name: 'Bot' },
          agents: [{ id: 'ag1', name: 'Bot' }],
        },
        appChats: [{ key: AGENT_CHAT_KEY, label: 'Bot' }],
        org: { id: 'o1', name: 'Acme', urn: 'hrn:org:acme.com', members: [{ user: { id: 'u1' }, role: 'ADMIN' }] },
      },
      form: null,
    }) as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(3);
    return m;
  }

  async function readyAiButton(target: HTMLElement, label: string) {
    const trigger = ([...target.querySelectorAll('button')] as HTMLButtonElement[]).find(b => b.textContent?.trim() === label)!;
    await vi.waitFor(() => expect(trigger.disabled).toBe(false));
    return trigger;
  }

  async function fillNewConfig(target: HTMLElement) {
    const add = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add configuration')!;
    add.click();
    flushSync();
    for (const [selector, value] of [['#ac-name', 'default'], ['#ac-model', 'claude-sonnet-5'], ['#ac-key', 'synthetic-key']] as const) {
      const input = target.querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
    }
    // The draft identity read precedes enabling its explicit submit.
    (await readyAiButton(target, 'Save')).click();
  }

  it('keeps a pending mutation, uncertainty and its replay lock while the AI tab is hidden', async () => {
    let rejectCreate!: (error: Error) => void;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (url === '/api/ai-configs/principal') return { ok: true, json: async () => ({ principal: { principalType: 'USER', userId: 'u1', appId: null } }) } as Response;
      if (url !== '/api/ai-configs' || init?.method !== 'POST') throw new Error(`unexpected fetch: ${url}`);
      const body = JSON.parse(init.body!);
      if (body.action === 'endpoints') return { ok: true, json: async () => ({ endpoints: [] }) } as Response;
      if (body.action === 'create') return new Promise<Response>((_, reject) => { rejectCreate = reject; });
      throw new Error(`unexpected action: ${body.action}`);
    }));
    const m = await mountAi();
    await fillNewConfig(m.target);
    await vi.waitFor(() => expect(typeof rejectCreate).toBe('function'));
    const panel = m.target.querySelector<HTMLElement>('#panel-ai-configs')!;
    const region = m.target.querySelector<HTMLElement>('[data-testid="ai-config-feedback"]')!;

    (m.target.querySelector('#tab-settings') as HTMLButtonElement).click();
    await tick(3);
    rejectCreate(new Error('dropped response'));
    await tick(30);
    expect(panel.hidden).toBe(true);
    expect(region.isConnected).toBe(true);
    expect(region.textContent).toContain('couldn’t confirm the change went through');

    (m.target.querySelector('#tab-ai-configs') as HTMLButtonElement).click();
    await tick(3);
    expect(panel.hidden).toBe(false);
    expect(m.target.querySelector('[data-testid="ai-config-feedback"]')).toBe(region);
    expect(region.textContent).toContain('couldn’t confirm the change went through');
    expect(([...m.target.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => b.textContent?.trim() === 'Save')!.disabled).toBe(true);
  });

  it('aborts a timed-out resolved-config fetch through the production callback', async () => {
    vi.useFakeTimers();
    let relatedSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string; signal?: AbortSignal }) => {
      if (url === '/api/ai-configs/principal') return { ok: true, json: async () => ({ principal: { principalType: 'USER', userId: 'u1', appId: null } }) } as Response;
      if (url === '/api/ai-configs?ownerType=APP&ownerId=a1') {
        return { ok: true, json: async () => ({ configs: [] }) } as Response;
      }
      if (url === '/api/ai-configs?appRef=a1&agentRef=ag1') {
        relatedSignal = init?.signal;
        return new Promise<Response>(() => {});
      }
      if (url !== '/api/ai-configs' || init?.method !== 'POST') throw new Error(`unexpected fetch: ${url}`);
      const body = JSON.parse(init.body!);
      if (body.action === 'endpoints') return { ok: true, json: async () => ({ endpoints: [] }) } as Response;
      if (body.action === 'create') return { ok: true, json: async () => ({ ok: true }) } as Response;
      throw new Error(`unexpected action: ${body.action}`);
    }));
    const m = await mountAi();
    await fillNewConfig(m.target);
    await tick(30);
    expect(relatedSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(relatedSignal?.aborted).toBe(true);
  });

  it('does not lock an org admin out when the App-member-only Chat read is withheld', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (url === '/api/ai-configs/principal') return { ok: true, json: async () => ({ principal: { principalType: 'USER', userId: 'u1', appId: null } }) } as Response;
      if (url === '/api/ai-configs?ownerType=APP&ownerId=a1') {
        return { ok: true, json: async () => ({ configs: [masked] }) } as Response;
      }
      if (url === '/api/ai-configs?appRef=a1&agentRef=ag1') {
        return { ok: true, json: async () => ({ withheld: true }) } as Response;
      }
      if (url !== '/api/ai-configs' || init?.method !== 'POST') throw new Error(`unexpected fetch: ${url}`);
      const body = JSON.parse(init.body!);
      if (body.action === 'endpoints') return { ok: true, json: async () => ({ endpoints: [] }) } as Response;
      if (body.action === 'create') return { ok: true, json: async () => ({ ok: true }) } as Response;
      throw new Error(`unexpected action: ${body.action}`);
    }));
    const m = await mountAi({ chatConfigs: null });
    await fillNewConfig(m.target);
    await tick(40);

    const feedback = m.target.querySelector('[data-testid="ai-config-feedback"]')!;
    expect(feedback.textContent).toContain('Saved “default”.');
    expect(feedback.textContent).not.toContain('couldn’t be refreshed');
    ([...m.target.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => b.textContent?.trim() === 'Add configuration')!.click();
    await tick(3);
    await readyAiButton(m.target, 'Save');
  });

  it('refreshes both the owner grid and resolved Chat configs across create and delete', async () => {
    let configs = [] as typeof masked[];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (url === '/api/ai-configs/principal') return { ok: true, json: async () => ({ principal: { principalType: 'USER', userId: 'u1', appId: null } }) } as Response;
      if (url === '/api/ai-configs?ownerType=APP&ownerId=a1' || url === '/api/ai-configs?appRef=a1&agentRef=ag1') {
        return { ok: true, json: async () => ({ configs }) } as Response;
      }
      if (url.startsWith('/api/agent-chat/list')) return { ok: true, json: async () => ({ chats: [] }) } as Response;
      if (url !== '/api/ai-configs' || init?.method !== 'POST') throw new Error(`unexpected fetch: ${url}`);
      const body = JSON.parse(init.body!);
      if (body.action === 'endpoints') return { ok: true, json: async () => ({ endpoints: [] }) } as Response;
      if (body.action === 'create') {
        configs = [masked];
        return { ok: true, json: async () => ({ ok: true, config: masked }) } as Response;
      }
      if (body.action === 'delete') {
        configs = [];
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      throw new Error(`unexpected action: ${body.action}`);
    }));
    const m = await mountAi({ chatConfigs: null });
    await fillNewConfig(m.target);
    await tick(40);
    expect(m.target.querySelector('[data-testid="ai-config-feedback"]')!.textContent).toContain('Saved “default”.');

    (m.target.querySelector('#tab-chats') as HTMLButtonElement).click();
    await tick(10);
    expect(m.target.querySelector('#agent-chat-ai-config')?.textContent).toContain('default (anthropic · claude-sonnet-5)');

    // Null loader reads are not identity tokens: App B must not inherit A's
    // resolved list, and returning to A restores only A's working copy.
    const appA = m.props.data as {
      app: Record<string, unknown>;
      chatConfigs: unknown;
      appConfigs: unknown;
    };
    m.props.data = {
      ...appA,
      app: { ...appA.app, id: 'b1', agentId: 'ag2' },
      chatConfigs: null,
      appConfigs: [],
      aiChoices: null,
    };
    await tick(10);
    expect(m.target.querySelector('#agent-chat-ai-config')).toBeNull();
    appA.appConfigs = [masked];
    m.props.data = appA;
    await tick(10);
    expect(m.target.querySelector('#agent-chat-ai-config')?.textContent).toContain('default (anthropic · claude-sonnet-5)');

    (m.target.querySelector('#tab-ai-configs') as HTMLButtonElement).click();
    await tick(3);
    (m.target.querySelector('button[aria-label="Actions for default"]') as HTMLButtonElement).click();
    flushSync();
    ([...m.target.querySelectorAll<HTMLElement>('[role="menuitem"]')]).find((x) => x.textContent?.trim() === 'Delete')!.click();
    flushSync();
    (await readyAiButton(m.target, 'Delete')).click();
    await tick(40);
    expect(m.target.querySelector('[data-testid="ai-config-feedback"]')!.textContent).toContain('Deleted “default”.');

    (m.target.querySelector('#tab-chats') as HTMLButtonElement).click();
    await tick(10);
    expect(m.target.querySelector('#agent-chat-ai-config')).toBeNull();
    expect(m.target.querySelector('#panel-chats')!.textContent).toContain('Connect an LLM provider to enable agent chat');
  });

  it('keeps recovery locked when a loader replacement drops the resolved-config readback', async () => {
    let releaseRelated!: (reply: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (url === '/api/ai-configs/principal') return { ok: true, json: async () => ({ principal: { principalType: 'USER', userId: 'u1', appId: null } }) } as Response;
      if (url === '/api/ai-configs?ownerType=APP&ownerId=a1') {
        return { ok: true, json: async () => ({ configs: [masked] }) } as Response;
      }
      if (url === '/api/ai-configs?appRef=a1&agentRef=ag1') {
        return new Promise<Response>((resolve) => { releaseRelated = resolve; });
      }
      if (url !== '/api/ai-configs' || init?.method !== 'POST') throw new Error(`unexpected fetch: ${url}`);
      const body = JSON.parse(init.body!);
      if (body.action === 'endpoints') return { ok: true, json: async () => ({ endpoints: [] }) } as Response;
      if (body.action === 'create') return { ok: true, json: async () => ({ ok: true }) } as Response;
      throw new Error(`unexpected action: ${body.action}`);
    }));
    const m = await mountAi({ chatConfigs: [] });
    await fillNewConfig(m.target);
    await tick(30);
    expect(releaseRelated).toBeTypeOf('function');

    const loader = m.props.data as Record<string, unknown>;
    m.props.data = { ...loader, chatConfigs: [] };
    await tick(5);
    releaseRelated({ ok: true, json: async () => ({ configs: [masked] }) } as Response);
    await tick(40);
    expect(m.target.querySelector('[data-testid="ai-config-feedback"]')!.textContent).toContain('couldn’t be refreshed');
  });

  it('supersedes a resolved-config working copy on a same-App null loader generation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (url === '/api/ai-configs/principal') return { ok: true, json: async () => ({ principal: { principalType: 'USER', userId: 'u1', appId: null } }) } as Response;
      if (url === '/api/ai-configs?ownerType=APP&ownerId=a1' || url === '/api/ai-configs?appRef=a1&agentRef=ag1') {
        return { ok: true, json: async () => ({ configs: [masked] }) } as Response;
      }
      if (url.startsWith('/api/agent-chat/list')) return { ok: true, json: async () => ({ chats: [] }) } as Response;
      if (url !== '/api/ai-configs' || init?.method !== 'POST') throw new Error(`unexpected fetch: ${url}`);
      const body = JSON.parse(init.body!);
      if (body.action === 'endpoints') return { ok: true, json: async () => ({ endpoints: [] }) } as Response;
      if (body.action === 'create') return { ok: true, json: async () => ({ ok: true }) } as Response;
      throw new Error(`unexpected action: ${body.action}`);
    }));
    const m = await mountAi({ chatConfigs: null });
    await fillNewConfig(m.target);
    await tick(40);
    (m.target.querySelector('#tab-chats') as HTMLButtonElement).click();
    await tick(10);
    expect(m.target.querySelector('#agent-chat-ai-config')?.textContent).toContain('default (anthropic · claude-sonnet-5)');

    // The new loader generation's list wins over the superseded working copy.
    const loader = m.props.data as Record<string, unknown>;
    m.props.data = { ...loader, chatConfigs: null, aiChoices: [defaultChoice] };
    await tick(10);
    expect(optionValues(m.target)).toEqual(['default']);
  });

  it('masks stale resolved Chat configs when their readback fails after delete', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (url === '/api/ai-configs/principal') return { ok: true, json: async () => ({ principal: { principalType: 'USER', userId: 'u1', appId: null } }) } as Response;
      if (url === '/api/ai-configs?ownerType=APP&ownerId=a1') {
        return { ok: true, json: async () => ({ configs: [] }) } as Response;
      }
      if (url === '/api/ai-configs?appRef=a1&agentRef=ag1') {
        return { ok: false, status: 500, json: async () => ({ failed: true }) } as Response;
      }
      if (url.startsWith('/api/agent-chat/list')) return { ok: true, json: async () => ({ chats: [] }) } as Response;
      if (url !== '/api/ai-configs' || init?.method !== 'POST') throw new Error(`unexpected fetch: ${url}`);
      const body = JSON.parse(init.body!);
      if (body.action === 'endpoints') return { ok: true, json: async () => ({ endpoints: [] }) } as Response;
      if (body.action === 'delete') return { ok: true, json: async () => ({ ok: true }) } as Response;
      throw new Error(`unexpected action: ${body.action}`);
    }));
    const m = await mountAi({ chatConfigs: [masked], appConfigs: [masked] });
    (m.target.querySelector('button[aria-label="Actions for default"]') as HTMLButtonElement).click();
    flushSync();
    ([...m.target.querySelectorAll<HTMLElement>('[role="menuitem"]')]).find((x) => x.textContent?.trim() === 'Delete')!.click();
    flushSync();
    (await readyAiButton(m.target, 'Delete')).click();
    await tick(40);

    (m.target.querySelector('#tab-chats') as HTMLButtonElement).click();
    await tick(10);
    // Nothing but `default` can be vouched for once the readback failed.
    expect(optionValues(m.target)).toEqual(['default']);
  });

  it('drops a deleted config from the dropdown without a reload (portal#1963)', async () => {
    const fast = { ...masked, id: 'c2', name: 'fast' };
    let configs = [fast, masked];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (url === '/api/ai-configs/principal') return { ok: true, json: async () => ({ principal: { principalType: 'USER', userId: 'u1', appId: null } }) } as Response;
      if (url === '/api/ai-configs?ownerType=APP&ownerId=a1' || url === '/api/ai-configs?appRef=a1&agentRef=ag1') {
        return { ok: true, json: async () => ({ configs }) } as Response;
      }
      if (url.startsWith('/api/agent-chat/list')) return { ok: true, json: async () => ({ chats: [] }) } as Response;
      if (url !== '/api/ai-configs' || init?.method !== 'POST') throw new Error(`unexpected fetch: ${url}`);
      const body = JSON.parse(init.body!);
      if (body.action === 'endpoints') return { ok: true, json: async () => ({ endpoints: [] }) } as Response;
      if (body.action === 'delete') {
        configs = [masked];
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      throw new Error(`unexpected action: ${body.action}`);
    }));
    const m = await mountAi({
      chatConfigs: [fast, masked], appConfigs: [fast, masked],
      aiChoices: [defaultChoice, choice('c2', 'fast'), choice('c1', 'default')],
    });
    (m.target.querySelector('#tab-chats') as HTMLButtonElement).click();
    await tick(10);
    const picker = m.target.querySelector<HTMLSelectElement>('#agent-chat-ai-config')!;
    picker.value = 'c2';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(optionValues(m.target)).toEqual(['default', 'c2', 'c1']);

    (m.target.querySelector('#tab-ai-configs') as HTMLButtonElement).click();
    await tick(3);
    (m.target.querySelector('button[aria-label="Actions for fast"]') as HTMLButtonElement).click();
    flushSync();
    ([...m.target.querySelectorAll<HTMLElement>('[role="menuitem"]')]).find((x) => x.textContent?.trim() === 'Delete')!.click();
    flushSync();
    (await readyAiButton(m.target, 'Delete')).click();
    await vi.waitFor(() => expect(configs.map(c => c.id)).toEqual(['c1']));

    (m.target.querySelector('#tab-chats') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(optionValues(m.target)).toEqual(['default', 'c1']));
    // The deleted pick is no longer shown (or sent): the dropdown falls back to `default`.
    expect(m.target.querySelector<HTMLSelectElement>('#agent-chat-ai-config')!.value).toBe('default');
  });

  it('resets the Chat config selection when App or agent identity changes', async () => {
    const fast = { ...masked, id: 'c2', name: 'fast' };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/agent-chat/list')) return { ok: true, json: async () => ({ chats: [] }) } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const m = await mountAi({
      chatConfigs: [fast, masked], aiChoices: [defaultChoice, choice('c2', 'fast'), choice('c1', 'default')],
    });
    (m.target.querySelector('#tab-chats') as HTMLButtonElement).click();
    await tick(10);
    const picker = m.target.querySelector<HTMLSelectElement>('#agent-chat-ai-config')!;
    picker.value = 'c2';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(picker.value).toBe('c2');

    const loader = m.props.data as { app: Record<string, unknown> };
    m.props.data = {
      ...loader,
      app: { ...loader.app, id: 'b1', agentId: 'ag2' },
      chatConfigs: [{ ...fast, id: 'b2' }, { ...masked, id: 'b3' }],
      aiChoices: [defaultChoice, choice('b2', 'fast'), choice('b3', 'default')],
    };
    await tick(10);
    expect(m.target.querySelector<HTMLSelectElement>('#agent-chat-ai-config')!.value).toBe('default');
  });
});

// portal#1068 — the Client tab's "Download setup files" mints a key through
// /api/create-app-key. A manager refusal must reach the reader as the rule,
// not as "Failed to create client key." with the reason dropped.
describe('Client tab: a refused key mint (#1068)', () => {
  const MANAGERS_ONLY = 'Only people who manage this App can mint, revoke and scope its keys: its owners and, for an organization’s App, that organization’s owners and admins.';

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
    await vi.waitFor(() => expect(target.textContent).toContain(MANAGERS_ONLY));
    expect(alertSpy).not.toHaveBeenCalled();
    const alertEl = [...target.querySelectorAll('[role="alert"]')].find((el) => el.textContent?.includes(MANAGERS_ONLY));
    expect(alertEl).toBeTruthy();
    expect(target.textContent).not.toContain('Failed to create client key.');
  });

  it('a body with no error text falls back to the generic copy, inline (unchanged by #1106)', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const target = await mountClient(async () => new Response('gateway', { status: 502 }));
    downloadButton(target).click();
    await vi.waitFor(() => expect(target.textContent).toContain('Failed to create client key.'));
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

// portal#1153 (hadron-server#2109): App.viewerManages hides the key controls and nothing else.
describe('key controls follow App.viewerManages (portal#1153)', () => {
  const MANAGERS = 'Only people who manage this App can mint, revoke and scope its keys';
  const COMBINED = 'Only people who manage this App can see, create or revoke its keys';
  const HIDDEN = 'Only the App’s managers can see its keys.';
  const UNKNOWN = 'Couldn’t check whether you can manage this App’s keys. If you can’t, the change will be refused.';
  const IMPERSONATION = 'This is a read-only impersonation session, so it can’t mint, revoke or scope keys.';
  const FAILED = 'Couldn’t load this App’s keys.';
  const key = {
    id: 'k1', label: 'router', keyPreview: 'hk_ab…yz',
    createdAt: '2026-10-01T12:00:00.000Z', lastUsedAt: null, revokedAt: null,
  };
  async function mountTab(tab: 'keys' | 'client', over: Record<string, unknown>, app: Record<string, unknown> = {}) {
    setStubPage(`https://example.test/app/apps/a1?tab=${tab}`, { appId: 'a1' });
    const data = await pageData();
    const m = mountComponent(Page as never, reactiveProps({
      data: { ...data, initialTab: tab, keyScopes: { kind: 'hidden' }, appKeys: { kind: 'ok', keys: [key] }, app: { ...data.app, ...app }, ...over }, form: null,
    }) as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    return m.target.querySelector(`#panel-${tab}`)!;
  }
  const manager = { viewerManages: { kind: 'known', manages: true } };
  const nonManager = { viewerManages: { kind: 'known', manages: false } };
  const unknown = { viewerManages: { kind: 'unknown' } };
  const createForm = (p: Element) => p.querySelector('form[action="?/createKey"]');
  const revoke = (p: Element) => p.querySelector('form[action="?/revokeKey"]');
  const openNewKey = async (p: Element) => {
    [...p.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'New Client Key')?.click();
    await tick(2);
  };
  const setupButton = (p: Element) => [...p.querySelectorAll('button')].find((b) => b.textContent?.includes('Download setup files'));

  it('a manager sees the controls and no extra line', async () => {
    const keys = await mountTab('keys', manager);
    expect(createForm(keys)).not.toBeNull();
    expect(keys.textContent).not.toContain(MANAGERS);
    expect(keys.textContent).not.toContain(UNKNOWN);
    const client = await mountTab('client', manager);
    expect(revoke(client)).not.toBeNull();
    await openNewKey(client);
    expect(setupButton(client)).toBeDefined();
    expect(client.textContent).not.toContain(UNKNOWN);
  });

  it('keys tab: false removes the create form from the DOM and says who can', async () => {
    const panel = await mountTab('keys', nonManager);
    expect(createForm(panel)).toBeNull();
    expect(panel.querySelector('form[action="?/revokeKey"]')).toBeNull();
    expect(panel.querySelector('[data-testid="key-controls-withheld"]')?.textContent).toContain(MANAGERS);
    expect(panel.textContent).not.toContain(UNKNOWN);
    // The Keys tab stays in the strip for a non-manager, so the rule stays discoverable.
    expect([...document.querySelectorAll('[role=tab]')].some((t) => t.textContent?.includes('App Keys'))).toBe(true);
  });

  it('keys tab: false with the list also hidden shows ONE combined line, not two', async () => {
    const panel = await mountTab('keys', { ...nonManager, appKeys: { kind: 'hidden' } });
    expect(panel.textContent).toContain(COMBINED);
    expect(panel.textContent).not.toContain(HIDDEN);
    expect(panel.textContent?.split(COMBINED).length).toBe(2);
    expect(createForm(panel)).toBeNull();
  });

  it('a hidden key list outranks unknown: controls withheld, no unknown line', async () => {
    const panel = await mountTab('keys', { ...unknown, appKeys: { kind: 'hidden' } });
    expect(createForm(panel)).toBeNull();
    expect(panel.textContent).toContain(COMBINED);
    expect(panel.textContent).not.toContain(UNKNOWN);
  });

  it('impersonation swaps the managers line for the read-only sentence', async () => {
    const panel = await mountTab('keys', { ...nonManager, impersonation: { expiresAt: '2099-01-01T00:00:00Z' } });
    expect(panel.textContent).toContain(IMPERSONATION);
    expect(panel.textContent).not.toContain(MANAGERS);
    expect(createForm(panel)).toBeNull();
  });

  it('keys tab: unknown KEEPS the controls and adds one neutral status line', async () => {
    const panel = await mountTab('keys', unknown);
    expect(createForm(panel)).not.toBeNull();
    const note = panel.querySelector('[data-testid="key-controls-unknown"]');
    expect(note?.textContent).toBe(UNKNOWN);
    expect(note?.getAttribute('role')).toBe('status');
    expect(panel.textContent).not.toContain(MANAGERS);
  });

  it('unknown with the key list failed too shows both different reads', async () => {
    const panel = await mountTab('keys', { ...unknown, appKeys: { kind: 'failed' } });
    expect(panel.textContent).toContain(FAILED);
    expect(panel.textContent).toContain(UNKNOWN);
    expect(createForm(panel)).not.toBeNull();
  });

  it('client tab: false removes Revoke and the setup download, with a next step', async () => {
    const panel = await mountTab('client', nonManager, { organizationId: 'o1' });
    expect(revoke(panel)).toBeNull();
    expect(setupButton(panel)).toBeUndefined();
    expect(panel.querySelector('#keyLabel')).toBeNull();
    expect(panel.querySelector('[data-testid="setup-withheld"]')?.textContent).toContain('Ask one of its owners');
  });

  it('client tab: an org-owned App names the organization in the next step', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=client', { appId: 'a1' });
    const data = await pageData();
    const m = mountComponent(Page as never, reactiveProps({
      data: { ...data, initialTab: 'client', keyScopes: { kind: 'hidden' }, ...nonManager, org: { id: 'o1', name: 'Acme', members: [] }, app: { ...data.app, organizationId: 'o1' } }, form: null,
    }) as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    expect(m.target.querySelector('[data-testid="setup-withheld"]')?.textContent).toContain('an admin of Acme');
  });

  it('client tab: unknown keeps Revoke and the download, with the neutral line', async () => {
    const panel = await mountTab('client', unknown);
    expect(revoke(panel)).not.toBeNull();
    await openNewKey(panel);
    expect(setupButton(panel)).toBeDefined();
    expect(panel.querySelector('[data-testid="key-controls-unknown"]')?.textContent).toBe(UNKNOWN);
  });

  it('false never gates the plugin checkboxes (a separate rule, #1138 territory)', async () => {
    const panel = await mountTab('client', { ...nonManager, canManageApp: true });
    const boxes = panel.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    expect(boxes.length).toBeGreaterThan(0);
    expect([...boxes].every((b) => !b.disabled)).toBe(true);
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
      selectedChatKey: id, selectedChannelId: id,
      chatRootsPage: { offset: 20, count: 5, total: 25, firstHref: null, previousHref: '/app/apps/a1?tab=chats', nextHref: null },
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
    expect(m.target.querySelector('form[action*="postChannelMessage"]')?.getAttribute('action')).toContain('chatRootsOffset=20');
    expect(m.target.textContent).not.toContain('Showing the first 200 chats');
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

describe('focusTab and a navigation the busy guard cancelled (#1833)', () => {
  async function mountChats() {
    setStubPage('http://localhost/app/apps/a1?tab=chats', { appId: 'a1' });
    const base = await pageData();
    const data = { ...base, initialTab: 'chats', selectedChatKey: 'other', selectedChannelId: 'other', selectedChannelMessages: [],
      selectedChannelTotal: 0, selectedChannelError: false,
      postChannelMessageForm: await superValidate({ channelRef: 'other' }, zod4(postTeamChatMessageSchema), { errors: false, id: 'channel:other' }),
    };
    const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const textarea = m.target.querySelector<HTMLTextAreaElement>('textarea[name=body]')!;
    textarea.value = 'post during preload';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const result = await superValidate({ body: 'post during preload', channelRef: 'other' }, zod4(postTeamChatMessageSchema), { id: 'channel:other', errors: false });
    result.message = { type: 'success', text: 'Posted.' };
    return { m, form: textarea.closest('form')!, result };
  }
  /** Kit runs beforeNavigate for the owned goto; a guard that cancels makes goto resolve with no commit. */
  const kitGoto = (cancel: ReturnType<typeof vi.fn>) => () => {
    const navigation = {
      type: 'goto', to: { url: new URL('/app/apps/a1?tab=runs', window.location.href) },
      from: { url: new URL('http://localhost/app/apps/a1?tab=chats') }, cancel, willUnload: false,
    };
    for (const guard of navigationGuards.filter((entry) => entry.fn === 'beforeNavigate')) {
      (guard.callback as (nav: unknown) => void)(navigation);
    }
  };
  const selected = (m: Mounted<Record<string, unknown>>, id: string) => m.target.querySelector(`#tab-${id}`)?.getAttribute('aria-selected');

  it('does not select Runs when the busy guard cancelled the owned navigation (post started during the preload)', async () => {
    const { m, form, result } = await mountChats();
    let releasePreload!: () => void;
    navigationHooks.onPreloadData = () => new Promise((resolve) => {
      releasePreload = () => resolve({ type: 'loaded', status: 200, data: { runsPanel: null } });
    });
    const cancel = vi.fn();
    navigationHooks.onGoto = kitGoto(cancel);
    m.target.querySelector<HTMLButtonElement>('#tab-runs')!.click();
    await tick(2);
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: { form: result } }, async () => {
      await tick(2);
      releasePreload();
      await tick(10);
    });
    await tick(5);

    expect(cancel).toHaveBeenCalled();
    expect(selected(m, 'chats')).toBe('true');
    expect(selected(m, 'runs')).toBe('false');
  });

  it('control: with no post the owned navigation commits and Runs is selected', async () => {
    const { m } = await mountChats();
    navigationHooks.onPreloadData = () => Promise.resolve({ type: 'loaded', status: 200, data: { runsPanel: null } });
    const cancel = vi.fn();
    navigationHooks.onGoto = kitGoto(cancel);
    m.target.querySelector<HTMLButtonElement>('#tab-runs')!.click();
    await tick(10);

    expect(cancel).not.toHaveBeenCalled();
    expect(selected(m, 'runs')).toBe('true');
  });

  it('control: a post already busy before the click stops at entry, with no navigation', async () => {
    const { m, form, result } = await mountChats();
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: { form: result } }, async () => {
      await tick(2);
      m.target.querySelector<HTMLButtonElement>('#tab-runs')!.click();
      await tick(5);
    });
    expect(navigationCalls.filter((call) => call.fn === 'goto')).toHaveLength(0);
    expect(selected(m, 'runs')).toBe('false');
  });

  it('control: a rejected goto keeps the current tab', async () => {
    const { m } = await mountChats();
    navigationHooks.onPreloadData = () => Promise.resolve({ type: 'loaded', status: 200, data: { runsPanel: null } });
    navigationHooks.onGoto = () => Promise.reject(new Error('loader failed'));
    m.target.querySelector<HTMLButtonElement>('#tab-runs')!.click();
    await tick(10);
    expect(selected(m, 'runs')).toBe('false');
    expect(selected(m, 'chats')).toBe('true');
  });
});

describe('Cast role follows the selected Agent (#1319)', () => {
  it('has no role input and updates the read-only role when the Agent changes', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=staff', { appId: 'a1' });
    const data = await pageData();
    Object.assign(data.app, { agents: [
      { id: 'agent-a', name: 'Portal Engineer', urn: 'hrn:agent:acme.com:portal', personaRole: 'portal-engineer' },
      { id: 'agent-b', name: 'QA Engineer', urn: 'hrn:agent:acme.com:qa', personaRole: 'qa-engineer' },
    ] });
    data.initialTab = 'staff';
    const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const open = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cast a worker');
    expect(open).toBeDefined();
    open!.click();
    await tick(2);
    const form = m.target.querySelector<HTMLFormElement>('form[action="?/castWorker"]')!;
    expect(form).not.toBeNull();
    expect(form.querySelector('[name="role"]')).toBeNull();
    expect(new FormData(form).has('role')).toBe(false);
    const role = form.querySelector('#castRole')!;
    expect(role.textContent).toContain('Select an agent to see its role.');
    const agent = form.querySelector<HTMLSelectElement>('[name="agentId"]')!;
    for (const [id, expected] of [['agent-a', 'portal-engineer'], ['agent-b', 'qa-engineer'], ['', 'Select an agent to see its role.']]) {
      agent.value = id;
      agent.dispatchEvent(new Event('change', { bubbles: true }));
      await tick(2);
      expect(role.textContent).toContain(expected);
      const expectedUrn = id === 'agent-a' ? 'hrn:agent:acme.com:portal' : id === 'agent-b' ? 'hrn:agent:acme.com:qa' : null;
      const urnCopies = form.querySelectorAll('button[title="Copy URN"]');
      expect(urnCopies).toHaveLength(expectedUrn ? 1 : 0);
      if (expectedUrn) expect(form.querySelector(`span[title="${expectedUrn}"]`)).not.toBeNull();
      expect(new FormData(form).has('role')).toBe(false);
    }
  });

  // portal#1796: a `disabled` submit button drops keyboard focus to <body> in Chromium (the real
  // proof is scripts/test-cast-submit-focus.mjs); jsdom cannot see that, so this pins the contract
  // that proof relies on: while casting the button is aria-disabled and NOT disabled.
  it('keeps the Cast button focusable (aria-disabled, not disabled) while casting', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=staff', { appId: 'a1' });
    const data = await pageData();
    Object.assign(data.app, { agents: [{ id: 'agent-a', name: 'Portal Engineer', urn: 'hrn:agent:acme.com:portal', personaRole: 'portal-engineer' }] });
    data.initialTab = 'staff';
    Object.assign(data.castWorkerForm.data, { agentId: 'agent-a', name: 'Probe', reporting: 'none' });
    const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cast a worker')!.click();
    await tick(2);
    const form = m.target.querySelector<HTMLFormElement>('form[action="?/castWorker"]')!;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.getAttribute('aria-disabled')).not.toBe('true');
    submit.focus();
    const pending = await submitEnhancedDeferred(form);
    await tick(2);
    expect(submit.textContent).toContain('Casting');
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    expect(submit.disabled).toBe(false);
    expect(document.activeElement).toBe(submit);
    const id = form.querySelector<HTMLInputElement>('input[name="__superform_id"]')!.value;
    await pending.finish({
      type: 'failure', status: 409,
      data: { form: { id, valid: false, posted: true, errors: {}, data: { agentId: 'agent-a', name: 'Probe', reporting: 'none' }, message: { type: 'error', text: 'That name is already taken.' } } },
    });
    await tick(3);
    // A refused cast keeps the composer open with the typed name, shows the refusal, and is
    // submittable again (aria-disabled cleared).
    expect(m.target.querySelector('[data-testid="cast-answer-alert"]')!.textContent).toContain('That name is already taken.');
    expect(m.target.querySelector<HTMLInputElement>('form[action="?/castWorker"] [name="name"]')!.value).toBe('Probe');
    expect(submit.getAttribute('aria-disabled')).not.toBe('true');
    expect(document.activeElement).toBe(submit);
  });

  it.each([null, '', '   '])('shows an explicit no-role state for a restored selected Agent with role %j', async (personaRole) => {
    setStubPage('https://example.test/app/apps/a1?tab=staff', { appId: 'a1' });
    const data = await pageData();
    Object.assign(data.app, { agents: [
      { id: 'roleless', name: 'Changed Agent', urn: 'hrn:agent:acme.com:changed', personaRole },
      { id: 'valid', name: 'Portal Engineer', urn: 'hrn:agent:acme.com:portal', personaRole: 'portal-engineer' },
    ] });
    data.initialTab = 'staff';
    Object.assign(data.castWorkerForm.data, { agentId: 'roleless' });
    const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cast a worker')!.click();
    await tick(2);
    const form = m.target.querySelector<HTMLFormElement>('form[action="?/castWorker"]')!;
    expect(form.querySelector('#castRole')?.textContent).toContain('This agent has no role. Choose a different agent.');
    expect(form.querySelector('#castRole')?.textContent).not.toContain('Select an agent');
    expect(form.querySelector('[name="role"]')).toBeNull();
    expect(form.querySelector('span[title="hrn:agent:acme.com:changed"]')).not.toBeNull();
  });

});

describe('creating a new App memory (#487)', () => {
  async function memoryPage(role: string, installed = true) {
    const data = await pageData();
    return { ...data, createMemoryForm: await superValidate(zod4(createAppMemorySchema),{id:'createAppMemory:a1',errors:false}), canCreateMemory: role === 'OWNER' || role === 'ADMIN', initialTab: 'memory', currentUserId: 'u1', org: { id:'o1',name:'Acme',urn:'hrn:org:acme.com',members:[{role,user:{id:'u1'}}] }, app: {...data.app, organizationId:'o1',agents:installed?[{id:'ag1',name:'Role',urn:'hrn:agent:acme.com:role'}]:[]}, appMemories: [{id:'m1',name:'Project notes',urn:'hrn:mem:acme.com:notes',description:'Shared notes'}] };
  }
  it.each(['OWNER','ADMIN'])('offers creation for an org %s with an installed Agent', async role => {
    setStubPage('http://localhost/app/apps/a1?tab=memory', {appId:'a1'});
    const m=mountComponent(Page as never,{data:await memoryPage(role),form:null} as never) as Mounted<Record<string,unknown>>;mounted.push(m);await tick();
    expect(m.target.querySelector('form[action="?/createMemory"]')).not.toBeNull();
    expect(m.target.textContent).toContain('Project notes');
    expect(m.target.querySelector('[title="hrn:mem:acme.com:notes"]')).not.toBeNull();
    expect(m.target.querySelector('select[name=memoryClass],input[name=memoryRef]')).toBeNull();
  });
  it.each(['CONTRIBUTOR','READER'])('hides creation from org %s even if App.role says OWNER',async role=>{
    const data=await memoryPage(role);const m=mountComponent(Page as never,{data,form:null} as never) as Mounted<Record<string,unknown>>;mounted.push(m);await tick();
    expect(m.target.querySelector('form[action="?/createMemory"]')).toBeNull();
  });
});

describe('App memory scope inventory (#1043)', () => {
  const scopeRow = (id: string, kind = 'AGENT_LINK', viewerCanWrite = true) => ({ memoryId: id, memoryUrn: `hrn:mem:acme.com:${id}`, name: `Scope ${id}`, class: 'knowledge', viewerCanWrite, sources: [{ kind, agentId: kind === 'TEAM_SPACE' ? null : 'withheld-agent' }] });
  async function showSettings(scope: unknown) {
    setStubPage('https://example.test/app/apps/a1?tab=settings', { appId: 'a1' });
    const data = { ...await pageData(), initialTab: 'settings', appMemoryScope: scope };
    // A participant App with two Agents. The deprecated first Agent has a
    // misleading write role; the new inventory must follow the leaf projection.
    Object.assign(data.app, { agent: { id: 'first', name: 'First', memoryItems: [{ role: 'read-write', memory: { id: 'old', urn: 'hrn:mem:acme.com:old', name: 'OLD FIRST ONLY' } }] }, agents: [{ id: 'first', name: 'First' }, { id: 'role-agent', name: 'Engineer' }] });
    const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m); await tick(3);
    const button = [...m.target.querySelectorAll('button')].find(b => b.textContent?.includes('Accessible Memories'));
    expect(button).toBeTruthy(); button!.click(); await tick(3);return m;
  }
  it('lists all admitted participant memories, including team space, with no first-Agent fallback', async () => {
    const m = await showSettings([scopeRow('team', 'TEAM_SPACE'), scopeRow('role'), scopeRow('base', 'INHERITED_BASE'), scopeRow('read-only', 'AGENT_LINK', false)]);
    expect(m.target.textContent).toContain('Scope team');expect(m.target.textContent).toContain('Scope role');expect(m.target.textContent).toContain('Scope base');
    expect(m.target.textContent).not.toContain('OLD FIRST ONLY');
    expect(m.target.textContent).not.toContain('withheld-agent');
    expect(m.target.textContent).toContain('Agent link');
  });
  it('renders failed scope as an error, never as an empty inventory', async () => {
    const m=await showSettings(null);expect([...m.target.querySelectorAll('[role="alert"]')].some(el => el.textContent?.includes('Could not load'))).toBe(true);expect(m.target.textContent).not.toContain('No accessible memories');
  });
  it('renders successful empty scope distinctly', async () => {
    const m=await showSettings([]);expect(m.target.textContent).toContain('No accessible memories');expect(m.target.textContent).not.toContain('OLD FIRST ONLY');
  });
});

describe('App Settings: task integrations draft (LOCAL review of #1614, P2-2)', () => {
  it('does not follow the person to another App: an open draft is dropped on an App change', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=settings', { appId: 'a1' });
    const data = await pageData();
    const props = reactiveProps({
      data: {
        ...data, user: { id: 'u1' }, initialTab: 'settings', staff: [],
        appProperties: { kind: 'ok', revision: 1, properties: { taskIntegrations: [{ name: 'app-a-integration', provider: 'github', repositories: ['o/a'] }] } },
      },
      form: null,
    });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(3);
    const edit = [...m.target.querySelectorAll<HTMLButtonElement>('[data-task-integrations] button')].find((b) => b.textContent?.trim() === 'Edit')!;
    edit.click();
    await tick(3);
    expect(m.target.querySelector<HTMLInputElement>('[data-task-integrations] input[type="text"]')!.value).toBe('app-a-integration');

    props.data = {
      ...props.data,
      app: { ...props.data.app, id: 'a2', urn: 'hrn:app:acme.com:other', name: 'Other App' },
      appProperties: { kind: 'ok', revision: 7, properties: { taskIntegrations: [{ name: 'app-b-integration', provider: 'github', repositories: ['o/b'] }] } },
    };
    await tick(3);
    const section = m.target.querySelector('[data-task-integrations]')!;
    expect(section.querySelector('form')).toBeNull();
    expect(section.textContent).toContain('app-b-integration');
    expect(section.textContent).not.toContain('app-a-integration');
  });
});

it('portal#1410 carries an explicit filter focus request through the route-keyed thread remount', async () => {
  setStubPage('https://example.test/app/apps/a1?tab=chats&chat=chats:team', {appId:'a1'});
  const data=await pageData();
  const tagged={...message(1,'w1'),teamTags:[{headId:'head-ada',label:'team.ada'}]};
  const props=reactiveProps({data:{...data,teamChatMessages:[tagged],teamFilter:{kind:'none'} as TeamChatFilter},form:null});
  const m=mountComponent(Page as never,props as never) as Mounted<Record<string,unknown>>;
  mounted.push(m);document.body.append(m.target);await tick(3);
  const status=m.target.querySelector('[data-testid="team-chat-filter-status"]');
  let finishNavigation!:()=>void;
  navigationHooks.onGoto=()=>new Promise<void>(resolve=>{finishNavigation=resolve;});
  const tag=m.target.querySelector<HTMLButtonElement>('[data-testid="team-chat-tag"]')!;
  tag.focus();tag.click();await tick(2);
  expect(navigationCalls.some(c=>c.fn==='goto'&&String(c.args[0]).includes('team=head-ada'))).toBe(true);
  props.data={...props.data,teamFilter:{kind:'teams',headRefs:['head-ada']}};
  await tick(2);finishNavigation();await tick(5);
  const active=m.target.querySelector('[data-testid="team-chat-filter-active"]');
  expect(active).not.toBeNull();expect(document.activeElement).toBe(active);
  expect(m.target.querySelector('[data-testid="team-chat-filter-status"]')).toBe(status);
  expect(m.target.querySelector('[data-testid="team-chat-filter-status"]')?.textContent).toContain('team.ada');
});

describe('portal#1624 BLIND refused and abandoned filter navigation', () => {
  const tagged = { ...message(1, 'w1'), teamTags: [{headId:'head-ada', label:'team.ada'}] };
  const refusal: TeamChatRefusal = {code:'TEAM_CHAT_TEAM_HEAD_INVALID', message:'Team broadcast target is unavailable in this Channel.'};
  async function setup(invalid = false) {
    setStubPage('https://example.test/app/apps/a1?tab=chats&chat=chats:team',{appId:'a1'});
    const data=await pageData();
    const props=reactiveProps({data:{...data,teamChatMessages:invalid?[]:[tagged],teamFilter:{kind:'none'} as TeamChatFilter,teamFilterInvalid:invalid,teamChatError:invalid,teamChatRefusal:null as TeamChatRefusal|null},form:null});
    const m=mountComponent(Page as never,props as never) as Mounted<Record<string,unknown>>;
    mounted.push(m);document.body.append(m.target);await tick(3);
    let release!:()=>void;
    navigationHooks.onGoto=()=>new Promise<void>(r=>{release=r;});
    return {m,props,release:()=>release()};
  }
  const status=(m:Mounted<Record<string,unknown>>)=>m.target.querySelector('[data-testid="team-chat-filter-status"]')!;
  const selectTag=async(m:Mounted<Record<string,unknown>>)=>{
    const tag=m.target.querySelector<HTMLButtonElement>('[data-testid="team-chat-tag"]')!;
    tag.focus();tag.click();await tick(2);
  };
  it('a refused filter never announces selected and cannot reapply its intent on a later healthy reload',async()=>{
    const {m,props,release}=await setup();await selectTag(m);
    props.data={...props.data,app:{...props.data.app},teamFilter:{kind:'teams',headRefs:['head-ada']},teamChatMessages:[],teamChatError:true,teamChatRefusal:refusal};
    await tick(3);release();await tick(5);
    expect(m.target.querySelector('[data-testid="team-chat-filter-refused"]')?.textContent).toBe(refusal.message);
    expect(status(m).textContent).not.toContain('selected');
    // #2250 round 5 (Gil P2-1): on the REAL route a refused read lands with the REQUESTED set applied, so the
    // filter DID change. The sentence must say it was refused, never "did not change", and focus goes to a control
    // that exists among the applied chips.
    await tick(10); // the clear-then-set announcement needs a flush between its two writes
    expect(status(m).textContent).toContain('The team filter was refused.');
    expect(status(m).textContent).not.toContain('did not change');
    expect(m.target.querySelector('[data-testid="team-chat-filter-active"][data-head="head-ada"]')).not.toBeNull();
    expect(document.activeElement).toBe(m.target.querySelector('[data-testid="team-chat-filter-active"][data-head="head-ada"]'));
    props.data={...props.data,teamChatMessages:[tagged],teamChatError:false,teamChatRefusal:null};await tick(4);
    expect(status(m).textContent).not.toContain('selected');
  });
  it('an invalid navigation cancels intent even when its filter key differs; a later matching history visit is not a new choice',async()=>{
    const {m,props,release}=await setup();await selectTag(m);
    props.data={...props.data,teamFilterInvalid:true,teamChatError:true,teamChatMessages:[]};await tick(3);release();await tick(4);
    expect(status(m).textContent).not.toContain('selected');
    props.data={...props.data,teamFilter:{kind:'teams',headRefs:['head-ada']},teamFilterInvalid:false,teamChatError:false,teamChatMessages:[tagged]};await tick(5);
    expect(status(m).textContent).not.toContain('selected');
    expect(document.activeElement).not.toBe(m.target.querySelector('[data-testid="team-chat-filter-active"]'));
  });
  it('a completed navigation that did not apply its requested key cannot fire on a later history visit',async()=>{
    const {m,props,release}=await setup();await selectTag(m);release();await tick(4);
    props.data={...props.data,teamFilter:{kind:'teams',headRefs:['head-ada']}};await tick(5);
    expect(status(m).textContent).not.toContain('selected');
    expect(document.activeElement).not.toBe(m.target.querySelector('[data-testid="team-chat-filter-active"]'));
  });
  it('a rejected old navigation cannot cancel a newer choice',async()=>{
    const {m,props}=await setup();
    const bo={...tagged,nodeId:'m2',seq:2,teamTags:[{headId:'head-bo',label:'team.bo'}]};
    props.data={...props.data,teamChatMessages:[tagged,bo]};await tick(3);
    const pending:Array<{resolve:()=>void;reject:(error:Error)=>void}>=[];
    navigationHooks.onGoto=()=>new Promise<void>((resolve,reject)=>{pending.push({resolve,reject});});
    await selectTag(m);
    const second=m.target.querySelectorAll<HTMLButtonElement>('[data-testid="team-chat-tag"]')[1];
    second.focus();second.click();await tick(2);
    pending[0].reject(new Error('old navigation cancelled'));await tick(3);
    // #2250 fix round: the second click SUPERSEDED the first, so it computed
    // from the pending request's set ({ada} + bo) — its navigation targets
    // BOTH heads and the applied URL carries both. The #1624 property this
    // pin guards is untouched: the old navigation's rejection consumed none
    // of the newer choice, which completes and announces.
    props.data={...props.data,app:{...props.data.app},teamFilter:{kind:'teams',headRefs:['head-ada','head-bo']},teamChatMessages:[bo]};
    await tick(3);pending[1].resolve();await tick(5);
    expect(status(m).textContent).toContain('team.bo');
    // Focus lands on the chip the click ADDED (head-bo's), not chip 1.
    expect(document.activeElement).toBe(m.target.querySelector('[data-testid="team-chat-filter-active"][data-head="head-bo"]'));
  });
  it('clearing an initially invalid view still focuses and announces the healthy explicit All choice',async()=>{
    const {m,props,release}=await setup(true);
    const all=[...m.target.querySelectorAll<HTMLButtonElement>('[data-testid="team-chat-filter"] button')].find(b=>b.textContent?.includes('All messages'))!;
    all.focus();all.click();await tick(3);
    props.data={...props.data,app:{...props.data.app},teamFilterInvalid:false,teamChatError:false,teamChatMessages:[tagged]};await tick(3);release();await tick(5);
    const applied=[...m.target.querySelectorAll<HTMLButtonElement>('[data-testid="team-chat-filter"] button')].find(b=>b.textContent?.includes('All messages'))!;
    expect(document.activeElement).toBe(applied);expect(status(m).textContent).toContain('All messages selected.');
  });
  // portal#1629 (Liam's LOCAL gaps on #1624, Gabriel's optional coverage): three pins, no production change.
  const untaggedButton=(m:Mounted<Record<string,unknown>>)=>[...m.target.querySelectorAll<HTMLButtonElement>('[data-testid="team-chat-filter"] button')].find(b=>b.textContent?.includes('No team tag recorded'))!;
  it('portal#1629 the sole rejected navigation consumes its intent: no stale announcement and no replay on a later history visit',async()=>{
    const {m,props}=await setup();
    const pending:Array<{resolve:()=>void;reject:(error:Error)=>void}>=[];
    navigationHooks.onGoto=()=>new Promise<void>((resolve,reject)=>{pending.push({resolve,reject});});
    await selectTag(m);
    props.data={...props.data,app:{...props.data.app},teamFilter:{kind:'teams',headRefs:['head-ada']}};await tick(3);pending[0].resolve();await tick(5);
    expect(status(m).textContent).toContain('team.ada');
    const untagged=untaggedButton(m);untagged.focus();untagged.click();await tick(2);
    expect(pending).toHaveLength(2);
    pending[1].reject(new Error('navigation failed'));await tick(5);
    expect(status(m).textContent).toBe('');
    props.data={...props.data,app:{...props.data.app},teamFilter:{kind:'untagged'}};await tick(5);
    expect(status(m).textContent).toBe('');
    // Positive form (Gloria P2): the untagged chip exists and is the applied filter, yet focus was NOT pulled to it.
    expect(untaggedButton(m).getAttribute('aria-pressed')).toBe('true');
    expect(m.target.querySelector('[data-testid="team-chat-filter-active"]')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
  it('#2250 round 5 (Gil P2-2): a lone rejected navigation with the URL unchanged and no refusal drops the pending view back to the applied filter',async()=>{
    const {m}=await setup();
    const pending:Array<{resolve:()=>void;reject:(error:Error)=>void}>=[];
    navigationHooks.onGoto=()=>new Promise<void>((resolve,reject)=>{pending.push({resolve,reject});});
    await selectTag(m);
    // While the read is in flight the view shows the requested set.
    expect(m.target.querySelector('[data-testid="team-chat-filter-active"][data-head="head-ada"]')).not.toBeNull();
    pending[0].reject(new Error('navigation failed'));await tick(5);
    // No URL change, no refusal: the request is consumed, the chips return to the applied (unfiltered) view.
    expect(m.target.querySelector('[data-testid="team-chat-filter-active"]')).toBeNull();
    const all=[...m.target.querySelectorAll<HTMLButtonElement>('[data-testid="team-chat-filter"] button')].find(b=>b.textContent?.includes('All messages'))!;
    expect(all.getAttribute('aria-pressed')).toBe('true');
  });
  it('portal#1629 focus moved to another thread control, then destroyed by the keyed remount, is left on BODY (not pulled to the chip)',async()=>{
    const {m,props,release}=await setup();await selectTag(m);
    expect(navigationCalls.filter(c=>c.fn==='goto')).toHaveLength(1);
    const other=untaggedButton(m);other.focus();expect(document.activeElement).toBe(other);
    props.data={...props.data,app:{...props.data.app},teamFilter:{kind:'teams',headRefs:['head-ada']}};await tick(3);release();await tick(5);
    expect(m.target.contains(other)).toBe(false);
    expect(document.activeElement).toBe(document.body);
    expect(status(m).textContent).toContain('team.ada');
  });
  it('portal#1629 choosing the untagged filter announces its own neutral text',async()=>{
    const {m,props,release}=await setup();
    const untagged=untaggedButton(m);untagged.focus();untagged.click();await tick(2);
    expect(navigationCalls.filter(c=>c.fn==='goto')).toHaveLength(1);
    props.data={...props.data,app:{...props.data.app},teamFilter:{kind:'untagged'}};await tick(3);release();await tick(5);
    expect(status(m).textContent).toBe('Showing messages with no team tag recorded.');
  });
});

it('portal#1624 QA restores the newer composer focus after the keyed route destroys that textarea', async()=>{
  setStubPage('https://example.test/app/apps/a1?tab=chats&chat=chats:team',{appId:'a1'});
  const data=await pageData();
  const tagged={...message(1,'w1'),teamTags:[{headId:'head-ada',label:'team.ada'}]};
  const props=reactiveProps({data:{...data,teamChatMessages:[tagged],teamFilter:{kind:'none'} as TeamChatFilter},form:null});
  const m=mountComponent(Page as never,props as never) as Mounted<Record<string,unknown>>;
  mounted.push(m);document.body.append(m.target);await tick(3);
  let release!:()=>void;navigationHooks.onGoto=()=>new Promise<void>(r=>{release=r;});
  const tag=m.target.querySelector<HTMLButtonElement>('[data-testid="team-chat-tag"]')!;tag.focus();tag.click();await tick(2);
  const oldComposer=m.target.querySelector<HTMLTextAreaElement>('#team-chat-body')!;
  oldComposer.focus();oldComposer.value='draft typed while navigation waits';oldComposer.dispatchEvent(new Event('input',{bubbles:true}));await tick(3);
  props.data={...props.data,app:{...props.data.app},teamFilter:{kind:'teams',headRefs:['head-ada']}};await tick(3);release();await tick(5);
  const newComposer=m.target.querySelector<HTMLTextAreaElement>('#team-chat-body')!;
  expect(newComposer).not.toBe(oldComposer);expect(newComposer.value).toBe('draft typed while navigation waits');
  expect(document.activeElement).toBe(newComposer);
});

// portal#1469 (P3-5): the component test passes showDescription directly, so
// nothing pinned the PAGE wiring — the Description column must follow whether
// the App belongs to an organization (its memories read carries descriptions),
// not any other condition. A user-owned App has no org, so no Description
// column; an org App keeps it.
describe('App memories Description column wiring (portal#1469)', () => {
  const memoryRows = [
    // non-null descriptions so the org direction proves the column renders
    // data, not just a header, and the user-owned direction proves the data
    // does not leak without the column.
    { id: 'm1', urn: 'hrn:mem:acme.com:m1', name: 'First', description: 'a note', appId: 'a1' },
    { id: 'm2', urn: 'hrn:mem:acme.com:m2', name: 'Second', description: 'another note', appId: 'a1' },
  ];
  async function mountMemoryTab(app: Record<string, unknown>): Promise<HTMLElement> {
    setStubPage('https://example.test/app/apps/a1?tab=memory', { appId: 'a1' });
    window.history.replaceState({}, '', '/app/apps/a1?tab=memory');
    const data = await pageData();
    const createMemoryForm = await superValidate(zod4(createAppMemorySchema), { id: 'createAppMemory:a1', errors: false });
    const m = mountComponent(Page as never, {
      data: { ...data, user: { id: 'u1' }, initialTab: 'memory', app: { ...data.app, ...app }, appMemories: memoryRows, createMemoryForm },
      form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    return m.target;
  }
  it('a user-owned App (no organizationId) renders the memories grid without the Description column', async () => {
    const target = await mountMemoryTab({ organizationId: null });
    const headers = [...target.querySelectorAll('th')].map((h) => h.textContent?.trim() ?? '');
    expect(headers.some((h) => h.startsWith('Description'))).toBe(false);
    expect(headers.some((h) => h.startsWith('Name'))).toBe(true);
    expect(target.textContent).toContain('First');
    expect(target.textContent).not.toContain('a note');
  });
  it('an org-owned App keeps the Description column', async () => {
    const target = await mountMemoryTab({ organizationId: 'o1' });
    const headers = [...target.querySelectorAll('th')].map((h) => h.textContent?.trim() ?? '');
    expect(headers.some((h) => h.startsWith('Description'))).toBe(true);
    expect(target.textContent).toContain('First');
    expect(target.textContent).toContain('a note');
    expect(target.textContent).toContain('another note');
  });
});

// ── hadron-portal#1149: the cast asks a deliberate reporting choice ──────────
describe('Cast reporting choice (#1149)', () => {
  async function openCast(staff?: Array<Record<string, unknown>>) {
    setStubPage('https://example.test/app/apps/a1?tab=staff', { appId: 'a1' });
    const data = await pageData();
    Object.assign(data.app, { agents: [
      { id: 'agent-a', name: 'Portal Engineer', urn: 'hrn:agent:acme.com:portal', personaRole: 'portal-engineer' },
    ] });
    if (staff) (data as { staff: unknown }).staff = staff;
    data.initialTab = 'staff';
    const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cast a worker')!.click();
    await tick(2);
    const form = m.target.querySelector<HTMLFormElement>('form[action="?/castWorker"]')!;
    return { m, form };
  }
  const radios = (form: HTMLFormElement) => [...form.querySelectorAll<HTMLInputElement>('input[name="reporting"]')];
  // The id the server would echo back: the one this form instance posts.
  const idOf = (form: HTMLFormElement) => form.querySelector<HTMLInputElement>('[name="__superform_id"]')!.value;

  it('starts with NEITHER choice selected and no head picker: nothing is guessed', async () => {
    const { form } = await openCast();
    const [head, none] = radios(form);
    expect(head.value).toBe('head');
    expect(none.value).toBe('none');
    expect(head.checked).toBe(false);
    expect(none.checked).toBe(false);
    expect(form.querySelector('#castReportsTo')).toBeNull();
    expect(new FormData(form).has('reporting')).toBe(false);
    expect(form.querySelector('fieldset legend')?.textContent).toContain('Reports to');
  });

  it('choosing a worker reveals the picker of ACTIVE workers only, with the URN under the name', async () => {
    const { form } = await openCast([
      { id: 'w1', name: 'Ada', urn: 'hrn:worker:acme.com:team:ada', role: 'coordinator', retiredAt: null },
      { id: 'w2', name: 'Old', urn: 'hrn:worker:acme.com:team:old', role: 'qa', retiredAt: '2026-09-01T00:00:00.000Z' },
    ]);
    const [head] = radios(form);
    head.click();
    await tick(2);
    const pick = form.querySelector<HTMLSelectElement>('#castReportsTo')!;
    expect(pick).not.toBeNull();
    expect([...pick.options].map((o) => o.value)).toEqual(['', 'w1']);
    expect(pick.value).toBe('');
    pick.value = 'w1';
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    expect(form.querySelector('span[title="hrn:worker:acme.com:team:ada"]')).not.toBeNull();
  });

  it('No team hides the picker and submits only the No team arm', async () => {
    const { form } = await openCast();
    const [head, none] = radios(form);
    head.click();
    await tick(2);
    none.click();
    await tick(2);
    expect(form.querySelector('#castReportsTo')).toBeNull();
    const data = new FormData(form);
    expect(data.get('reporting')).toBe('none');
    expect(data.has('reportsTo')).toBe(false);
  });

  it('a refused cast keeps the user’s choice for correction and shows the server’s sentence', async () => {
    const { m, form } = await openCast([
      { id: 'w1', name: 'Ada', urn: 'hrn:worker:acme.com:team:ada', role: 'coordinator', retiredAt: null },
    ]);
    (form.querySelector('[name="agentId"]') as HTMLSelectElement).value = 'agent-a';
    form.querySelector('[name="agentId"]')!.dispatchEvent(new Event('change', { bubbles: true }));
    (form.querySelector('[name="name"]') as HTMLInputElement).value = 'Iris';
    form.querySelector('[name="name"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    radios(form)[0].click();
    await tick(2);
    const pick = form.querySelector<HTMLSelectElement>('#castReportsTo')!;
    pick.value = 'w1';
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    const result = await superValidate(
      { agentId: 'agent-a', name: 'Iris', reporting: 'head', reportsTo: 'w1' },
      zod4(castWorkerSchema),
      { errors: false, id: idOf(form) },
    );
    result.valid = false;
    result.message = { type: 'error', text: 'Worker not found in this App.' };
    await submitEnhancedWithResult(form, { type: 'failure', status: 500, data: { form: result } });
    await tick(3);
    expect(m.target.textContent).toContain('Worker not found in this App.');
    // Still a head, still Ada: the permanent cast was refused, nothing re-sent.
    expect(radios(form)[0].checked).toBe(true);
    expect(radios(form)[1].checked).toBe(false);
    expect(form.querySelector<HTMLSelectElement>('#castReportsTo')!.value).toBe('w1');
  });
});

describe('Cast composer lifecycle (#1149, late result crosses App navigation)', () => {
  const AGENTS = [
    { id: 'agent-a', name: 'Portal Engineer', urn: 'hrn:agent:acme.com:portal', personaRole: 'portal-engineer' },
    { id: 'agent-b', name: 'Server Engineer', urn: 'hrn:agent:acme.com:server', personaRole: 'server-engineer' },
  ];
  async function dataFor(appId: string) {
    setStubPage(`https://example.test/app/apps/${appId}?tab=staff`, { appId });
    const data = await pageData();
    Object.assign(data.app, { id: appId, agents: AGENTS });
    data.initialTab = 'staff';
    return data;
  }
  async function openCast() {
    const props = reactiveProps({ data: await dataFor('a1'), form: null });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const open = () => [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cast a worker')!.click();
    open();
    await tick(2);
    const form = () => m.target.querySelector<HTMLFormElement>('form[action="?/castWorker"]')!;
    return { m, props, form, open };
  }
  const fill = async (form: HTMLFormElement, agent: string, name: string) => {
    const a = form.querySelector<HTMLSelectElement>('[name="agentId"]')!;
    a.value = agent; a.dispatchEvent(new Event('change', { bubbles: true }));
    const n = form.querySelector<HTMLInputElement>('[name="name"]')!;
    n.value = name; n.dispatchEvent(new Event('input', { bubbles: true }));
    form.querySelector<HTMLInputElement>('input[name="reporting"][value="none"]')!.click();
    await tick(2);
  };
  const idOf = (form: HTMLFormElement) => form.querySelector<HTMLInputElement>('[name="__superform_id"]')!.value;
  const success = async (id: string) => {
    const f = await superValidate({ agentId: 'agent-a', name: 'Iris', reporting: 'none', reportsTo: '' }, zod4(castWorkerSchema), { errors: false, id });
    f.message = { type: 'success', text: 'Worker cast.' };
    return { type: 'success' as const, status: 200, data: { form: f } };
  };

  it.each(['success', 'refusal'] as const)('#1777 cast %s remains in the same mounted region after held Runs navigation', async outcome => {
    const { m, form } = await openCast();
    const region = m.target.querySelector(`[data-testid="cast-answer-${outcome === 'success' ? 'status' : 'alert'}"]`);
    expect(region).not.toBeNull();
    expect(region!.textContent?.trim()).toBe('');
    await fill(form(), 'agent-a', 'Iris');
    const sent = idOf(form());
    const delayed = await submitEnhancedDeferred(form());
    let release!: () => void;
    navigationHooks.onGoto = () => new Promise<void>(r => { release = r; });
    m.target.querySelector<HTMLButtonElement>('#tab-runs')!.click();
    await tick(2);
    expect(release).toBeTypeOf('function');
    const result = await success(sent);
    if (outcome === 'refusal') {
      result.data.form.valid = false;
      result.data.form.message = { type: 'error', text: 'Name already taken.' };
    }
    await delayed.finish(outcome === 'success' ? result : { ...result, type: 'failure', status: 400 });
    await tick(3);
    expect(m.target.textContent).toContain(outcome === 'success' ? 'Worker cast.' : 'Name already taken.');
    release();
    await tick(3);
    expect(m.target.querySelector('#tab-runs')?.getAttribute('aria-selected')).toBe('true');
    expect(m.target.textContent).toContain(outcome === 'success' ? 'Worker cast.' : 'Name already taken.');
    expect(region).not.toBeNull();
    expect(m.target.contains(region)).toBe(true);
    expect(region!.getAttribute('role')).toBe(outcome === 'success' ? 'status' : 'alert');
    expect(region!.textContent).toContain(outcome === 'success' ? 'Worker cast.' : 'Name already taken.');
    expect([...m.target.querySelectorAll('[role="status"], [role="alert"]')].filter(el => el.textContent?.includes(outcome === 'success' ? 'Worker cast.' : 'Name already taken.'))).toHaveLength(1);
  });

  it('#1795 keeps the Runs payload when the cast refresh used the pre-navigation URL', async () => {
    const { m, props, form } = await openCast();
    await fill(form(), 'agent-a', 'Iris');
    const sent = idOf(form());
    const delayed = await submitEnhancedDeferred(form());
    let releaseRuns!: () => void;
    navigationHooks.onGoto = () => new Promise<void>((resolve) => { releaseRuns = resolve; });
    m.target.querySelector<HTMLButtonElement>('#tab-runs')!.click();
    await tick(2);

    const order: string[] = [];
    let releaseRefresh!: () => void;
    navigationHooks.onInvalidateAll = () => {
      order.push('refresh-requested');
      return new Promise<void>((resolve) => { releaseRefresh = resolve; });
    };
    const finishing = delayed.finish(await success(sent));
    await tick(4);

    // The held Runs navigation supplies its panel. The action's invalidation
    // response is deliberately held until afterwards, as in Cooper's repro.
    order.push('runs-response');
    props.data = { ...props.data, initialTab: 'runs', runsPanel: await runsPanel('held-run') };
    await tick(3);
    releaseRuns();
    await tick(20);
    expect(releaseRefresh).toBeTypeOf('function');

    // The action's refresh used the pre-Runs URL and has no Runs section.
    // Its late response must not erase the payload the held navigation loaded.
    props.data = { ...props.data, initialTab: 'staff', runsPanel: null };
    releaseRefresh();
    await finishing;
    await tick(6);

    expect(m.target.querySelector('#tab-runs')?.getAttribute('aria-selected')).toBe('true');
    expect(m.target.querySelector('#panel-runs')?.textContent).toContain('held-run');
    expect(m.target.querySelector('#panel-runs')?.textContent).not.toContain('Loading runs…');
    expect(order).toEqual(['refresh-requested', 'runs-response']);
    expect(navigationCalls.filter((call) => call.fn === 'invalidateAll')).toHaveLength(1);
  });

  it('#1795 QA: preloaded Runs survives an invalidated navigation payload', async () => {
    const { m, props, form } = await openCast();
    await fill(form(), 'agent-a', 'Iris');
    const sent = idOf(form());
    const delayed = await submitEnhancedDeferred(form());
    const preloaded = await runsPanel('preloaded-run');
    let releasePreload: (() => void) | undefined;
    navigationHooks.onPreloadData = () => new Promise((resolve) => {
      releasePreload = () => resolve({ type: 'loaded', status: 200, data: { runsPanel: preloaded } });
    });
    let releaseGoto!: () => void;
    navigationHooks.onGoto = () => new Promise<void>((resolve) => { releaseGoto = resolve; });
    m.target.querySelector<HTMLButtonElement>('#tab-runs')!.click();
    await tick(2);

    // Cedar's real-browser ordering: the old-URL action refresh applies while
    // the destination load is still held. Kit discards that destination's
    // eventual navigation payload, so props NEVER receive the fresh panel.
    navigationHooks.onInvalidateAll = async () => {
      props.data = { ...props.data, initialTab: 'staff', runsPanel: null };
    };
    await delayed.finish(await success(sent));
    await tick(4);
    releasePreload?.();
    await tick(2);
    releaseGoto();
    await tick(20);

    expect(m.target.querySelector('#tab-runs')?.getAttribute('aria-selected')).toBe('true');
    expect(m.target.querySelector('#panel-runs')?.textContent).toContain('preloaded-run');
    expect(m.target.querySelector('#panel-runs')?.textContent).not.toContain('Loading runs…');
    expect(navigationCalls.filter((call) => call.fn === 'preloadData')).toHaveLength(1);
  });

  it('#1825 clears a retained Runs payload when the principal changes on the same App', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=runs', { appId: 'a1' });
    const data = await pageData();
    data.initialTab = 'runs';
    data.runsPanel = await runsPanel('principal-one-run');
    const props = reactiveProps({ data, form: null });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(3);

    // Control: an old-URL refresh without a Runs section retains the panel for
    // the SAME principal, which is the #1795 behavior this key must preserve.
    props.data = { ...props.data, runsPanel: null };
    await tick(3);
    expect(m.target.querySelector('#panel-runs')?.textContent).toContain('principal-one-run');

    props.data = { ...props.data, currentUserId: 'u2', runsPanel: null };
    await tick(3);
    expect(m.target.querySelector('#panel-runs')?.textContent).not.toContain('principal-one-run');
    expect(m.target.querySelector('#panel-runs')?.textContent).toContain('Loading runs…');

    // The old payload was cleared, not merely hidden: returning to the first
    // principal without a fresh Runs response cannot resurrect it.
    props.data = { ...props.data, currentUserId: 'u1', runsPanel: null };
    await tick(3);
    expect(m.target.querySelector('#panel-runs')?.textContent).not.toContain('principal-one-run');
    expect(m.target.querySelector('#panel-runs')?.textContent).toContain('Loading runs…');
  });

  it.each(['newer tab', 'teardown', 'chat navigation', 'A-B-A navigation'] as const)('#1795 a completed stale preload does not navigate after %s', async (boundary) => {
    const { m } = await openCast();
    const preloaded = await runsPanel('stale-preloaded-run');
    let releasePreload!: () => void;
    navigationHooks.onPreloadData = () => new Promise((resolve) => {
      releasePreload = () => resolve({ type: 'loaded', status: 200, data: { runsPanel: preloaded } });
    });
    m.target.querySelector<HTMLButtonElement>('#tab-runs')!.click();
    await tick(2);
    if (boundary === 'newer tab') {
      m.target.querySelector<HTMLButtonElement>('#tab-staff')!.click();
      await tick(5);
      expect(m.target.querySelector('#tab-staff')?.getAttribute('aria-selected')).toBe('true');
    } else if (boundary === 'teardown') {
      m.unmount();
    } else {
      const destinations = boundary === 'chat navigation'
        ? ['https://example.test/app/apps/a1?tab=chats&chat=other']
        : ['https://example.test/app/apps/a2?tab=staff', 'https://example.test/app/apps/a1?tab=staff'];
      for (const destination of destinations) {
        const navigation = {
          type: 'goto', to: { url: new URL(destination) },
          from: { url: new URL('https://example.test/app/apps/a1?tab=staff') },
          cancel: vi.fn(), willUnload: false,
        };
        for (const guard of navigationGuards.filter((entry) => entry.fn === 'beforeNavigate')) {
          (guard.callback as (nav: unknown) => void)(navigation);
        }
      }
      await tick(3);
    }

    releasePreload();
    await tick(20);
    const destinations = navigationCalls.filter((call) => call.fn === 'goto').map((call) => String(call.args[0]));
    expect(destinations).toEqual(boundary === 'newer tab' ? ['/app/apps/a1?tab=staff'] : []);
  });

  // portal#1831: an external navigation supersedes a held Runs choice. The obsolete
  // focusTab can no longer release the pending latch (mine !== tabNavigation), so
  // the supersession itself must, or the next ordinary local tab click is forced
  // through goto and a failing goto blocks the switch.
  async function supersedeHeldRuns(m: { target: HTMLElement }) {
    let releasePreload!: () => void;
    navigationHooks.onPreloadData = () => new Promise((resolve) => {
      releasePreload = () => resolve({ type: 'loaded', status: 200, data: { runsPanel: null } });
    });
    m.target.querySelector<HTMLButtonElement>('#tab-runs')!.click();
    await tick(2);
    const navigation = {
      type: 'goto', to: { url: new URL('https://example.test/app/apps/a1?tab=chats&chat=other') },
      from: { url: new URL('https://example.test/app/apps/a1?tab=staff') },
      cancel: vi.fn(), willUnload: false,
    };
    for (const guard of navigationGuards.filter((entry) => entry.fn === 'beforeNavigate')) {
      (guard.callback as (nav: unknown) => void)(navigation);
    }
    await tick(3);
    return releasePreload;
  }

  it('#1831 a local tab click after an external navigation superseded Runs stays local', async () => {
    const { m } = await openCast();
    const releasePreload = await supersedeHeldRuns(m);
    releasePreload();
    await tick(10);
    navigationCalls.length = 0;
    navigationHooks.onGoto = () => Promise.reject(new Error('loader failed'));
    m.target.querySelector<HTMLButtonElement>('#tab-keys')!.click();
    await tick(5);

    expect(navigationCalls.filter((call) => call.fn === 'goto')).toHaveLength(0);
    expect(m.target.querySelector('#tab-keys')?.getAttribute('aria-selected')).toBe('true');
  });

  it('#1831 control: a local click with no pending choice stays local even if goto would fail', async () => {
    const { m } = await openCast();
    navigationHooks.onGoto = () => Promise.reject(new Error('loader failed'));
    m.target.querySelector<HTMLButtonElement>('#tab-keys')!.click();
    await tick(5);

    expect(navigationCalls.filter((call) => call.fn === 'goto')).toHaveLength(0);
    expect(m.target.querySelector('#tab-keys')?.getAttribute('aria-selected')).toBe('true');
  });

  it('#1831 releasing on supersession does not clear a NEWER focusTab-owned navigation', async () => {
    const { m } = await openCast();
    await supersedeHeldRuns(m);
    // A newer Runs choice after the external navigation owns the latch again.
    navigationHooks.onPreloadData = () => Promise.resolve({ type: 'loaded', status: 200, data: { runsPanel: null } });
    let releaseGoto!: () => void;
    navigationHooks.onGoto = () => new Promise<void>((resolve) => {
      // Kit runs beforeNavigate for the owned goto itself, with its exact URL.
      const navigation = {
        type: 'goto', to: { url: new URL('/app/apps/a1?tab=runs', window.location.href) },
        from: { url: new URL('https://example.test/app/apps/a1?tab=staff') },
        cancel: vi.fn(), willUnload: false,
      };
      for (const guard of navigationGuards.filter((entry) => entry.fn === 'beforeNavigate')) {
        (guard.callback as (nav: unknown) => void)(navigation);
      }
      releaseGoto = resolve;
    });
    navigationCalls.length = 0;
    m.target.querySelector<HTMLButtonElement>('#tab-runs')!.click();
    await tick(5);
    // Still pending: the owned goto neither bumped the epoch nor released the latch,
    // so a second choice is still routed through goto (and supersedes this one).
    expect(navigationCalls.filter((call) => call.fn === 'goto').map((call) => String(call.args[0]))).toEqual(['/app/apps/a1?tab=runs']);
    releaseGoto();
    await tick(10);
    // The owned navigation completed and was not treated as superseded.
    expect(m.target.querySelector('#tab-runs')?.getAttribute('aria-selected')).toBe('true');
  });

  it('#1831 a newer focusTab choice holding the latch is still pending when an owned navigation passes beforeNavigate', async () => {
    const { m } = await openCast();
    let releaseGoto!: () => void;
    navigationHooks.onPreloadData = () => Promise.resolve({ type: 'loaded', status: 200, data: { runsPanel: null } });
    navigationHooks.onGoto = () => new Promise<void>((resolve) => {
      const navigation = {
        type: 'goto', to: { url: new URL('/app/apps/a1?tab=runs', window.location.href) },
        from: { url: new URL('https://example.test/app/apps/a1?tab=staff') },
        cancel: vi.fn(), willUnload: false,
      };
      for (const guard of navigationGuards.filter((entry) => entry.fn === 'beforeNavigate')) {
        (guard.callback as (nav: unknown) => void)(navigation);
      }
      releaseGoto = resolve;
    });
    m.target.querySelector<HTMLButtonElement>('#tab-runs')!.click();
    await tick(5);
    navigationCalls.length = 0;
    navigationHooks.onGoto = undefined;
    // Latch must still be held: an ordinary local tab is routed through goto.
    m.target.querySelector<HTMLButtonElement>('#tab-keys')!.click();
    await tick(5);
    expect(navigationCalls.filter((call) => call.fn === 'goto').map((call) => String(call.args[0]))).toEqual(['/app/apps/a1?tab=keys']);
    releaseGoto?.();
    await tick(5);
  });

  it.each([false, true])('control: Runs renders with no action (navigation held=%s)', async (held) => {
    const { m, props } = await openCast();
    let releaseRuns: (() => void) | undefined;
    if (held) navigationHooks.onGoto = () => new Promise<void>((resolve) => { releaseRuns = resolve; });
    m.target.querySelector<HTMLButtonElement>('#tab-runs')!.click();
    await tick(2);
    props.data = { ...props.data, initialTab: 'runs', runsPanel: await runsPanel(`control-${held}-run`) };
    await tick(3);
    releaseRuns?.();
    await tick(20);

    expect(m.target.querySelector('#panel-runs')?.textContent).toContain(`control-${held}-run`);
    expect(m.target.querySelector('#panel-runs')?.textContent).not.toContain('Loading runs…');
    expect(navigationCalls.filter((call) => call.fn === 'invalidateAll')).toHaveLength(0);

    // A real Runs response always supersedes the retained payload.
    props.data = { ...props.data, runsPanel: await runsPanel(`fresh-${held}-run`) };
    await tick(3);
    expect(m.target.querySelector('#panel-runs')?.textContent).toContain(`fresh-${held}-run`);
    expect(m.target.querySelector('#panel-runs')?.textContent).not.toContain(`control-${held}-run`);

    // R2, not R1, is what a still-later old-URL omission must retain.
    props.data = { ...props.data, initialTab: 'staff', runsPanel: null };
    await tick(3);
    expect(m.target.querySelector('#panel-runs')?.textContent).toContain(`fresh-${held}-run`);
    expect(m.target.querySelector('#panel-runs')?.textContent).not.toContain(`control-${held}-run`);
  });

  it('#1795 never retains one App’s Runs payload on another App', async () => {
    const { m, props } = await openCast();
    m.target.querySelector<HTMLButtonElement>('#tab-runs')!.click();
    await tick(2);
    props.data = { ...props.data, initialTab: 'runs', runsPanel: await runsPanel('app-a-run') };
    await tick(3);
    expect(m.target.querySelector('#panel-runs')?.textContent).toContain('app-a-run');

    props.data = await dataFor('a2');
    await tick(3);
    expect(m.target.querySelector('#panel-runs')?.textContent).not.toContain('app-a-run');
    props.data = { ...props.data, initialTab: 'runs', runsPanel: { ...await runsPanel('app-b-run'), app: { id: 'a2', name: 'Other', organizationId: null } } };
    await tick(3);
    expect(m.target.querySelector('#panel-runs')?.textContent).toContain('app-b-run');
  });

  it.each([
    ['above', -80, -20, false, true],
    ['below', 800, 860, false, true],
    ['reduced motion', -80, -20, true, true],
    ['visible', 10, 70, false, false],
  ] as const)('#1777 refusal reveal: %s, without moving focus', async (_case, top, bottom, reduced, shouldScroll) => {
    const { m, form } = await openCast();
    await fill(form(), 'agent-a', 'Iris');
    const region = m.target.querySelector<HTMLElement>('[data-testid="cast-answer-alert"]')!;
    const scroll = vi.fn();
    region.scrollIntoView = scroll;
    vi.spyOn(region, 'getBoundingClientRect').mockReturnValue({ top, bottom } as DOMRect);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced })));
    const input = form().querySelector<HTMLInputElement>('[name="name"]')!;
    input.focus();
    const refused = async () => {
      const f = (await success(idOf(form()))).data.form;
      f.valid = false;
      f.message = { type: 'error', text: 'Name already taken.' };
      const pending = await submitEnhancedDeferred(form());
      await pending.finish({ type: 'failure', status: 400, data: { form: f } });
      await tick(3);
    };
    await refused();
    expect(region.textContent).toContain('Name already taken.');
    if (shouldScroll) expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: reduced ? 'instant' : 'smooth' });
    else expect(scroll).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    scroll.mockClear();
    await refused();
    // An identical refusal from another current submission still needs revealing.
    expect(scroll).toHaveBeenCalledTimes(shouldScroll ? 1 : 0);
  });

  it('a No team choice made for App A is not carried to App B', async () => {
    const { m, props, open, form } = await openCast();
    await fill(form(), 'agent-a', 'Iris');
    props.data = await dataFor('a2');
    await tick(3);
    open();
    await tick(2);
    expect(form().querySelector<HTMLInputElement>('input[name="reporting"][value="none"]')!.checked).toBe(false);
    expect(form().querySelector<HTMLInputElement>('[name="name"]')!.value).toBe('');
    expect(m.target.textContent).not.toContain('Worker cast.');
  });

  it('changing the selected Agent clears the reporting choice', async () => {
    const { form } = await openCast();
    await fill(form(), 'agent-a', 'Iris');
    expect(form().querySelector<HTMLInputElement>('input[name="reporting"][value="none"]')!.checked).toBe(true);
    const a = form().querySelector<HTMLSelectElement>('[name="agentId"]')!;
    a.value = 'agent-b'; a.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    expect(form().querySelector<HTMLInputElement>('input[name="reporting"][value="none"]')!.checked).toBe(false);
  });

  it('A’s late success does not close B’s composer, empty B’s draft or say Worker cast on B', async () => {
    const { m, props, form, open } = await openCast();
    await fill(form(), 'agent-a', 'Iris');
    const sent = idOf(form());
    const delayed = await submitEnhancedDeferred(form());
    props.data = await dataFor('a2');
    await tick(3);
    open();
    await tick(2);
    await fill(form(), 'agent-b', 'NewB');
    await delayed.finish(await success(sent));
    await tick(3);
    expect(form()).not.toBeNull();
    expect(form().querySelector<HTMLInputElement>('[name="name"]')!.value).toBe('NewB');
    expect(m.target.textContent).not.toContain('Worker cast.');
  });

  it('an old A attempt delivered after A -> B -> A does not touch the fresh A composer (late success, refusal, held refresh)', async () => {
    const { m, props, form, open } = await openCast();
    await fill(form(), 'agent-a', 'Iris');
    const sent = idOf(form());
    const delayed = await submitEnhancedDeferred(form());
    props.data = await dataFor('a2');
    await tick(3);
    props.data = await dataFor('a1');
    await tick(3);
    open();
    await tick(2);
    await fill(form(), 'agent-b', 'FreshA');
    await delayed.finish(await success(sent));
    await tick(3);
    expect(form()).not.toBeNull();
    expect(form().querySelector<HTMLInputElement>('[name="name"]')!.value).toBe('FreshA');
    expect(m.target.textContent).not.toContain('Worker cast.');
    expect(m.target.textContent).not.toContain('could not be refreshed');
  });

  it('an old A refusal delivered after A -> B -> A does not replace the fresh A draft', async () => {
    const { m, props, form, open } = await openCast();
    await fill(form(), 'agent-a', 'Iris');
    const sent = idOf(form());
    const delayed = await submitEnhancedDeferred(form());
    props.data = await dataFor('a2');
    await tick(3);
    props.data = await dataFor('a1');
    await tick(3);
    open();
    await tick(2);
    await fill(form(), 'agent-b', 'FreshA');
    const bad = await superValidate({ agentId: 'agent-a', name: 'Iris', reporting: 'none', reportsTo: '' }, zod4(castWorkerSchema), { errors: false, id: sent });
    bad.valid = false;
    bad.message = { type: 'error', text: 'That name is taken.' };
    await delayed.finish({ type: 'failure', status: 500, data: { form: bad } } as never);
    await tick(3);
    expect(form().querySelector<HTMLInputElement>('[name="name"]')!.value).toBe('FreshA');
    expect(m.target.textContent).not.toContain('That name is taken.');
  });

  it('an old A refresh that rejects after A -> B -> A adds no notice to the fresh A composer', async () => {
    const { m, props, form, open } = await openCast();
    await fill(form(), 'agent-a', 'Iris');
    let rejectRefresh!: (e: Error) => void;
    navigationHooks.onInvalidateAll = () => new Promise<void>((_, rej) => { rejectRefresh = rej; });
    const sent = idOf(form());
    const delayed = await submitEnhancedDeferred(form());
    const finished = delayed.finish(await success(sent));
    await tick(3);
    props.data = await dataFor('a2');
    await tick(3);
    props.data = await dataFor('a1');
    await tick(3);
    rejectRefresh(new Error('refresh failed'));
    await finished.catch(() => {});
    await tick(3);
    open();
    await tick(2);
    expect(m.target.textContent).not.toContain('could not be refreshed');
  });

  it('a request begun by a destroyed Page cannot seed the fresh mount (success and refusal)', async () => {
    for (const outcome of ['success', 'refusal'] as const) {
      const first = await openCast();
      await fill(first.form(), 'agent-a', 'Iris');
      const sent = idOf(first.form());
      const delayed = await submitEnhancedDeferred(first.form());
      first.m.unmount();
      const second = await openCast();
      await fill(second.form(), 'agent-b', 'FreshA');
      expect(idOf(second.form())).not.toBe(sent);
      if (outcome === 'success') {
        await delayed.finish(await success(sent));
      } else {
        const bad = await superValidate({ agentId: 'agent-a', name: 'Iris', reporting: 'none', reportsTo: '' }, zod4(castWorkerSchema), { errors: false, id: sent });
        bad.valid = false;
        bad.message = { type: 'error', text: 'That name is taken.' };
        await delayed.finish({ type: 'failure', status: 500, data: { form: bad } } as never);
      }
      await tick(3);
      expect(second.form()).not.toBeNull();
      expect(second.form().querySelector<HTMLInputElement>('[name="name"]')!.value).toBe('FreshA');
      expect(second.m.target.textContent).not.toContain('Worker cast.');
      expect(second.m.target.textContent).not.toContain('That name is taken.');
      second.m.unmount();
    }
  });

  it('control: the current App’s success clears and closes its own composer', async () => {
    const { m, form } = await openCast();
    await fill(form(), 'agent-a', 'Iris');
    const sent = idOf(form());
    const delayed = await submitEnhancedDeferred(form());
    await delayed.finish(await success(sent));
    await tick(3);
    expect(m.target.querySelector('form[action="?/castWorker"]')).toBeNull();
    expect(m.target.textContent).toContain('Worker cast.');
  });

  it('a refresh that rejects after a confirmed cast says so and never offers a blind repeat', async () => {
    const { m, form } = await openCast();
    await fill(form(), 'agent-a', 'Iris');
    navigationHooks.onInvalidateAll = () => { throw new Error('refresh failed after committed cast'); };
    const sent = idOf(form());
    const delayed = await submitEnhancedDeferred(form());
    await delayed.finish(await success(sent));
    await tick(4);
    expect(m.target.textContent).toContain('Worker cast.');
    expect(m.target.textContent).toContain('could not be refreshed');
    const cast = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cast a worker') as HTMLButtonElement;
    expect(cast.disabled).toBe(false);
  });

  // portal#1715 S1. Walks the App change across every await between Superforms
  // entering its result handler and finishing with it, for each outcome. This
  // sweep is what reproduced the defect on main: at 0 turns A's success emptied
  // B's draft, took focus and printed its receipt on B, and A's refusal wrote
  // A's draft over B's. `regimes` proves the walk reached both sides of the
  // result landing on A; a pass that never got there would say nothing.
  describe('leaving A at any point while its answer is applied (portal#1715)', () => {
    const NAME_TAKEN = 'That name is taken.';
    const UNCONFIRMED = 'The cast could not be confirmed. Reload the page to check before casting again.';
    const refused = async (id: string) => {
      const bad = await superValidate({ agentId: 'agent-a', name: 'Iris', reporting: 'none', reportsTo: '' }, zod4(castWorkerSchema), { errors: false, id });
      bad.valid = false;
      bad.message = { type: 'error', text: NAME_TAKEN };
      return { type: 'failure' as const, status: 500, data: { form: bad } };
    };
    const FAILED = { type: 'error', status: 500, error: { message: 'boom' } } as const;
    const REDIRECT = { type: 'redirect', status: 303, location: '/signin' } as const;
    const refreshes = () => navigationCalls.filter((c) => c.fn === 'invalidateAll').length;
    const castButton = (target: HTMLElement) => [...target.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Cast a worker')!;
    const submitButton = (target: HTMLElement) => [...target.querySelectorAll<HTMLButtonElement>('form[action="?/castWorker"] button[type="submit"]')].at(-1)!;
    async function typeOnB(m: Mounted<Record<string, unknown>>, form: () => HTMLFormElement) {
      castButton(m.target).click();
      flushSync();
      const name = form().querySelector<HTMLInputElement>('[name="name"]')!;
      name.value = 'NewB';
      name.dispatchEvent(new Event('input', { bubbles: true }));
      name.focus();
      flushSync();
      return name;
    }

    it.each([
      ['success', success, 'Worker cast.'],
      ['refusal', refused, NAME_TAKEN],
      ['a failed request', async () => FAILED, UNCONFIRMED],
    ] as const)('%s leaves B’s message, focus, composer and refreshes untouched', async (_name, answer, text) => {
      const regimes = new Set<string>();
      for (let turns = 0; turns <= 24; turns += 1) {
        const { m, props, form } = await openCast();
        await fill(form(), 'agent-a', 'Iris');
        const sent = idOf(form());
        const delayed = await submitEnhancedDeferred(form());
        const result = await answer(sent);
        const b = await dataFor('a2');
        resetNavigationCalls();
        const finishing = delayed.finish(result as never);
        for (let i = 0; i < turns; i += 1) await Promise.resolve();
        flushSync();
        regimes.add(m.target.textContent?.includes(text) ? 'shown-on-A' : 'not-yet-shown');
        const refreshedOnA = refreshes();
        props.data = b;
        flushSync();
        const name = await typeOnB(m, form);
        await finishing;
        await tick(4);
        const at = `${text} after ${turns} turns`;
        expect(m.target.textContent, at).not.toContain(text);
        expect(m.target.querySelector('form[action="?/castWorker"]'), at).not.toBeNull();
        expect(name.value, at).toBe('NewB');
        expect(form().querySelector<HTMLInputElement>('[name="name"]')!.value, at).toBe('NewB');
        expect(document.activeElement, at).toBe(name);
        expect(refreshes(), at).toBe(refreshedOnA);
        expect(submitButton(m.target).disabled, at).toBe(false);
        expect(kitAppliedResults, at).toEqual([]);
        m.unmount();
        mounted.pop();
      }
      expect([...regimes].sort()).toEqual(['not-yet-shown', 'shown-on-A']);
    });

    it('a failed request says the cast is unconfirmed, claims neither outcome and frees the form', async () => {
      const { m, form } = await openCast();
      await fill(form(), 'agent-a', 'Iris');
      const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit');
      const delayed = await submitEnhancedDeferred(form());
      await delayed.finish(FAILED as never);
      await tick(4);
      expect([...m.target.querySelectorAll('[role="alert"]')].map((x) => x.textContent?.trim())).toEqual([UNCONFIRMED]);
      expect(m.target.textContent).not.toContain('Worker cast.');
      expect(form().querySelector<HTMLInputElement>('[name="name"]')!.value).toBe('Iris');
      expect(submitButton(m.target).disabled).toBe(false);
      expect(refreshes()).toBe(0);
      expect(requestSubmit).not.toHaveBeenCalled();
    });

    it('a redirect still reaches Kit in the current App (applyAction is off for this form)', async () => {
      const { form } = await openCast();
      await fill(form(), 'agent-a', 'Iris');
      const delayed = await submitEnhancedDeferred(form());
      await delayed.finish(REDIRECT as never);
      await tick(4);
      expect(kitAppliedResults).toEqual([REDIRECT]);
    });

    it('A’s late redirect does not reach Kit on B', async () => {
      const { props, form } = await openCast();
      await fill(form(), 'agent-a', 'Iris');
      const delayed = await submitEnhancedDeferred(form());
      props.data = await dataFor('a2');
      await tick(3);
      await delayed.finish(REDIRECT as never);
      await tick(4);
      expect(kitAppliedResults).toEqual([]);
    });

    // Jane's BLIND on #1771: the fence read one variable that every submit overwrites, so a
    // submit on B made A's still-pending answer look current. B can submit by then: the
    // composer is a new element, and afterNavigate has cleared the form's submitting state.
    it.each([
      ['a failed request', async () => FAILED, UNCONFIRMED],
      ['a refusal', refused, NAME_TAKEN],
      ['a success', success, 'Worker cast.'],
      ['a redirect', async () => REDIRECT, null],
    ] as const)('%s for A, arriving after B submitted, stays off B', async (_name, answer, text) => {
      const { m, props, form } = await openCast();
      await fill(form(), 'agent-a', 'Iris');
      const sent = idOf(form());
      const first = await submitEnhancedDeferred(form());
      props.data = await dataFor('a2');
      await tick(3);
      await typeOnB(m, form);
      await submitEnhancedDeferred(form());
      const tabs = () => m.target.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
      const tab = tabs();
      resetNavigationCalls();
      await first.finish(await answer(sent) as never);
      await tick(4);
      if (text) expect(m.target.textContent).not.toContain(text);
      expect(form().querySelector<HTMLInputElement>('[name="name"]')!.value).toBe('NewB');
      expect(tabs()).toBe(tab);
      expect(refreshes()).toBe(0);
      expect(kitAppliedResults).toEqual([]);
    });

    it('B’s own answer still lands after A’s stale one', async () => {
      const { m, props, form } = await openCast();
      await fill(form(), 'agent-a', 'Iris');
      const first = await submitEnhancedDeferred(form());
      props.data = await dataFor('a2');
      await tick(3);
      await typeOnB(m, form);
      const sentB = idOf(form());
      const second = await submitEnhancedDeferred(form());
      await first.finish(FAILED as never);
      await tick(2);
      await second.finish(await refused(sentB) as never);
      await tick(4);
      expect(m.target.textContent).toContain(NAME_TAKEN);
      expect(m.target.textContent).not.toContain(UNCONFIRMED);
    });

    it('a success or refusal never goes through Kit, so focus stays where the reader put it', async () => {
      for (const answer of [success, refused]) {
        const { m, form } = await openCast();
        await fill(form(), 'agent-a', 'Iris');
        const sent = idOf(form());
        const delayed = await submitEnhancedDeferred(form());
        const outside = castButton(m.target);
        outside.focus();
        await delayed.finish(await answer(sent) as never);
        await tick(4);
        expect(kitAppliedResults).toEqual([]);
        expect(document.activeElement).toBe(outside);
        m.unmount();
        mounted.pop();
      }
    });

    it('a refusal keeps the composer: open, with the rejected draft, on the AI Team tab', async () => {
      const { m, form } = await openCast();
      await fill(form(), 'agent-a', 'Iris');
      const sent = idOf(form());
      const delayed = await submitEnhancedDeferred(form());
      await delayed.finish(await refused(sent) as never);
      await tick(4);
      expect(m.target.textContent).toContain(NAME_TAKEN);
      expect(form().querySelector<HTMLInputElement>('[name="name"]')!.value).toBe('Iris');
    });

    // With applyAction off, the `form` prop effects that used to do this never see a cast.
    async function closeAndLeave(m: Mounted<Record<string, unknown>>) {
      castButton(m.target).click();
      flushSync();
      expect(m.target.querySelector('form[action="?/castWorker"]')).toBeNull();
      m.target.querySelector<HTMLElement>('[role="tab"]:not(#tab-staff)')!.click();
      flushSync();
      expect(m.target.textContent).not.toContain('Cast a worker');
    }

    it('a refusal lands back on the AI Team tab and reopens a composer closed meanwhile', async () => {
      const { m, form } = await openCast();
      await fill(form(), 'agent-a', 'Iris');
      const sent = idOf(form());
      const delayed = await submitEnhancedDeferred(form());
      await closeAndLeave(m);
      await delayed.finish(await refused(sent) as never);
      await tick(4);
      expect(m.target.textContent).toContain(NAME_TAKEN);
      expect(m.target.querySelector('form[action="?/castWorker"]')).not.toBeNull();
    });

    it('a success lands back on the AI Team tab, where its receipt is', async () => {
      const { m, form } = await openCast();
      await fill(form(), 'agent-a', 'Iris');
      const sent = idOf(form());
      const delayed = await submitEnhancedDeferred(form());
      await closeAndLeave(m);
      await delayed.finish(await success(sent));
      await tick(4);
      expect(m.target.textContent).toContain('Worker cast.');
    });

    it('a failed request lands back on the AI Team tab and doesn’t reopen the composer: it claims nothing to retry', async () => {
      const { m, form } = await openCast();
      await fill(form(), 'agent-a', 'Iris');
      const delayed = await submitEnhancedDeferred(form());
      await closeAndLeave(m);
      await delayed.finish(FAILED as never);
      await tick(4);
      expect(m.target.textContent).toContain(UNCONFIRMED);
      expect(m.target.querySelector('form[action="?/castWorker"]')).toBeNull();
    });

    it('control: a clean success still closes the composer, says so and refreshes once', async () => {
      const { m, form } = await openCast();
      await fill(form(), 'agent-a', 'Iris');
      const sent = idOf(form());
      const delayed = await submitEnhancedDeferred(form());
      await delayed.finish(await success(sent));
      await tick(4);
      expect(m.target.querySelector('form[action="?/castWorker"]')).toBeNull();
      expect(m.target.textContent).toContain('Worker cast.');
      expect(refreshes()).toBe(1);
    });

    // portal#1715 S3: a live region mounted already holding its text isn't reliably
    // announced, so the region stays mounted and the notice arrives inside it. This
    // pins the DOM only: it says nothing about what a screen reader announced.
    it('the stale-list notice arrives inside a status region already mounted, and clears on the next submit', async () => {
      const { m, form, open } = await openCast();
      const region = m.target.querySelector('[data-testid="cast-refresh-status"]')!;
      expect(region.getAttribute('role')).toBe('status');
      expect(region.textContent?.trim()).toBe('');
      await fill(form(), 'agent-a', 'Iris');
      navigationHooks.onInvalidateAll = () => { throw new Error('refresh failed after committed cast'); };
      const sent = idOf(form());
      const delayed = await submitEnhancedDeferred(form());
      await delayed.finish(await success(sent));
      await tick(4);
      expect(m.target.querySelector('[data-testid="cast-refresh-status"]')).toBe(region);
      expect(region.textContent).toContain('Do not cast again.');
      expect(region.querySelector('[role="status"], [role="alert"], button')).toBeNull();
      open();
      await tick(2);
      await fill(form(), 'agent-a', 'Iris');
      await submitEnhancedDeferred(form());
      await tick(2);
      expect(region.textContent?.trim()).toBe('');
    });
  });

  // portal#1715 S3.
  describe('the agent list in the composer', () => {
    const IMPORTER = { id: 'ag0', name: 'Alpha', urn: 'hrn:agent:acme.com:alpha' };
    async function selectOf(installMarks: Record<string, unknown>) {
      const data = await dataFor('a1');
      const m = mountComponent(Page as never, reactiveProps({ data: { ...data, installMarks }, form: null }) as never) as Mounted<Record<string, unknown>>;
      mounted.push(m);
      await tick(2);
      [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cast a worker')!.click();
      await tick(2);
      return m.target.querySelector<HTMLSelectElement>('[name="agentId"]')!;
    }
    const groups = (select: HTMLSelectElement) => [...select.querySelectorAll('optgroup')].map((g) => g.label);

    it('the placeholder doesn’t say installed: the list can hold derived agents', async () => {
      expect((await selectOf({})).querySelector('option')!.textContent).toBe('— Select an agent —');
    });

    it('hides an empty Installed group', async () => {
      const select = await selectOf({ 'agent-a': { kind: 'derived', importer: IMPORTER }, 'agent-b': { kind: 'derived', importer: IMPORTER } });
      expect(groups(select)).toEqual(['Derived']);
    });

    it('control: both groups show when each has an agent', async () => {
      const select = await selectOf({ 'agent-a': { kind: 'installed' }, 'agent-b': { kind: 'derived', importer: IMPORTER } });
      expect(groups(select)).toEqual(['Installed', 'Derived']);
    });
  });
});

describe('Roster placement readback (#1149)', () => {
  async function rosterText(placements: Array<string | null>) {
    setStubPage('https://example.test/app/apps/a1?tab=staff', { appId: 'a1' });
    const data = await pageData();
    (data as { staff: unknown }).staff = placements.map((teamPlacement, i) => ({
      id: `w${i}`, name: `Worker${i}`, urn: `hrn:worker:acme.com:team:worker${i}`, role: 'qa',
      retiredAt: null, reportsToWorkerId: null, reportsToRetired: false, teamPlacement,
    }));
    data.initialTab = 'staff';
    const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(3);
    return (i: number) => [...m.target.querySelectorAll('tr')].find((r) => r.textContent?.includes(`Worker${i}`))?.textContent ?? '';
  }

  it('says No team and Not set for answered placements, and nothing for a masked null', async () => {
    const row = await rosterText(['NO_TEAM', 'UNSET', null]);
    expect(row(0)).toContain('No team');
    expect(row(1)).toContain('Not set');
    expect(row(2)).not.toContain('No team');
    expect(row(2)).not.toContain('Not set');
  });
});

describe('Install on a derived row: its result belongs to one App window (#1684, LOCAL on #1714)', () => {
  const BETA = { id: 'ag1', urn: 'hrn:agent:acme.com:beta', name: 'Beta', personaRole: null };
  const IMPORTER = { id: 'ag0', name: 'Alpha', urn: 'hrn:agent:acme.com:alpha' };
  const LINKED = 'Agent linked.';
  const REFUSED = 'That agent cannot be installed.';
  async function dataFor(appId: string) {
    setStubPage(`https://example.test/app/apps/${appId}?tab=agents`, { appId });
    const data = await pageData();
    Object.assign(data.app, { id: appId, agents: [BETA] });
    data.initialTab = 'agents';
    return { ...data, bootPointerAppKey: appId, installMarks: { ag1: { kind: 'derived', importer: IMPORTER } } };
  }
  const installForm = (target: HTMLElement) =>
    [...target.querySelectorAll<HTMLFormElement>('form[action="?/addAgent"]')].find((f) =>
      f.querySelector<HTMLInputElement>('[name="__superform_id"]')?.value.startsWith('installAgent:'))!;
  const actions = (target: HTMLElement) => target.querySelector<HTMLButtonElement>('button[aria-label="Actions for Beta"]')!;
  async function mountAgents() {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: true, json: async () => String(url).includes('/customisation?') ? { list: { state: 'not-shown' }, original: { state: 'not-shown' }, replacement: { state: 'not-shown' } } : {} }) as Response));
    const props = reactiveProps({ data: await dataFor('a1'), form: null });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    return { m, props };
  }
  // Goes through the row's own Install so the posted agent is the one it picked.
  async function beginInstall(target: HTMLElement) {
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    actions(target).click();
    flushSync();
    [...target.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find((i) => i.textContent?.trim() === 'Install')!.click();
    await tick(2);
    requestSubmit.mockRestore();
    const form = installForm(target);
    const id = form.querySelector<HTMLInputElement>('[name="__superform_id"]')!.value;
    return { id, delayed: await submitEnhancedDeferred(form) };
  }
  const confirmed = async (id: string) => {
    const f = await superValidate({ agentId: 'ag1' }, zod4(addAgentSchema), { errors: false, id });
    f.message = { type: 'success', text: LINKED };
    return { type: 'success' as const, status: 200, data: { form: f } };
  };
  const refused = async (id: string) => {
    const f = await superValidate({ agentId: 'ag1' }, zod4(addAgentSchema), { errors: false, id });
    f.valid = false;
    f.message = { type: 'error', text: REFUSED };
    return { type: 'failure' as const, status: 400, data: { form: f } };
  };
  const refreshes = () => navigationCalls.filter((c) => c.fn === 'invalidateAll').length;

  it('A’s late success says nothing on B and refreshes nothing there', async () => {
    const { m, props } = await mountAgents();
    const { id, delayed } = await beginInstall(m.target);
    props.data = await dataFor('a2');
    await tick(3);
    await delayed.finish(await confirmed(id) as never);
    await tick(4);
    expect(m.target.textContent).not.toContain(LINKED);
    expect(refreshes()).toBe(0);
    expect(actions(m.target).disabled).toBe(false);
  });

  // Same race as the cast's (Jane's BLIND on #1771, Xabat's ruling 6692838145). After a
  // navigation afterNavigate clears the form's submitting state, so B's row can Install while
  // A's request is out, and the fence read the variable that B's submit had just overwritten.
  describe('A’s answer arriving after B installed (portal#1715)', () => {
    const FAILED = { type: 'error', status: 500, error: { message: 'boom' } } as const;
    const REDIRECT = { type: 'redirect', status: 303, location: '/signin' } as const;
    const UNCONFIRMED = 'could not be confirmed';
    const navigated = async () => {
      for (const guard of navigationGuards.filter((g) => g.fn === 'afterNavigate')) (guard.callback as (nav: unknown) => void)({ type: 'link' });
      await tick(3);
    };
    async function pendingOnBoth() {
      const { m, props } = await mountAgents();
      const a = await beginInstall(m.target);
      props.data = await dataFor('a2');
      await tick(3);
      await navigated();
      const b = await beginInstall(m.target);
      resetNavigationCalls();
      return { m, a, b };
    }

    it.each([
      ['a failed request', async () => FAILED, UNCONFIRMED],
      ['a refusal', refused, REFUSED],
      ['a success', confirmed, LINKED],
      ['a redirect', async () => REDIRECT, null],
    ] as const)('%s stays off B', async (_name, answer, text) => {
      const { m, a } = await pendingOnBoth();
      await a.delayed.finish(await answer(a.id) as never);
      await tick(4);
      if (text) expect(m.target.textContent).not.toContain(text);
      expect(refreshes()).toBe(0);
      expect(kitAppliedResults).toEqual([]);
    });

    it('B’s own answer still lands after A’s stale one', async () => {
      const { m, a, b } = await pendingOnBoth();
      await a.delayed.finish(FAILED as never);
      await tick(2);
      await b.delayed.finish(await refused(b.id) as never);
      await tick(4);
      expect(m.target.textContent).toContain(REFUSED);
      expect(m.target.textContent).not.toContain(UNCONFIRMED);
    });
  });

  it('A’s late refusal says nothing on B', async () => {
    const { m, props } = await mountAgents();
    const { id, delayed } = await beginInstall(m.target);
    props.data = await dataFor('a2');
    await tick(3);
    await delayed.finish(await refused(id) as never);
    await tick(4);
    expect(m.target.textContent).not.toContain(REFUSED);
    expect(actions(m.target).disabled).toBe(false);
  });

  it('an attempt from before A -> B -> A is as stale as one from B (success and refusal)', async () => {
    for (const answer of [confirmed, refused]) {
      const { m, props } = await mountAgents();
      const { id, delayed } = await beginInstall(m.target);
      props.data = await dataFor('a2');
      await tick(3);
      props.data = await dataFor('a1');
      await tick(3);
      await delayed.finish(await answer(id) as never);
      await tick(4);
      expect(m.target.textContent).not.toContain(LINKED);
      expect(m.target.textContent).not.toContain(REFUSED);
      expect(refreshes()).toBe(0);
      expect(actions(m.target).disabled).toBe(false);
      m.unmount();
      mounted.pop();
    }
  });

  it('a request begun by a destroyed Page says nothing on a fresh mount (success and refusal)', async () => {
    for (const answer of [confirmed, refused]) {
      const first = await mountAgents();
      const { id, delayed } = await beginInstall(first.m.target);
      first.m.unmount();
      mounted.pop();
      const second = await mountAgents();
      expect(installForm(second.m.target).querySelector<HTMLInputElement>('[name="__superform_id"]')!.value).not.toBe(id);
      await delayed.finish(await answer(id) as never);
      await tick(4);
      expect(second.m.target.textContent).not.toContain(LINKED);
      expect(second.m.target.textContent).not.toContain(REFUSED);
      expect(refreshes()).toBe(0);
      second.m.unmount();
      mounted.pop();
    }
  });

  it('leaving the App takes its receipt with it', async () => {
    const { m, props } = await mountAgents();
    const { id, delayed } = await beginInstall(m.target);
    await delayed.finish(await confirmed(id) as never);
    await tick(4);
    expect(m.target.textContent).toContain(LINKED);
    props.data = await dataFor('a2');
    await tick(4);
    expect(m.target.textContent).not.toContain(LINKED);
  });

  it('control: the current App’s success shows its receipt and refreshes once', async () => {
    const { m } = await mountAgents();
    const { id, delayed } = await beginInstall(m.target);
    await delayed.finish(await confirmed(id) as never);
    await tick(4);
    expect(m.target.textContent).toContain(LINKED);
    expect(refreshes()).toBe(1);
    expect(actions(m.target).disabled).toBe(false);
  });

  it('control: the current App’s refusal shows and refreshes nothing', async () => {
    const { m } = await mountAgents();
    const { id, delayed } = await beginInstall(m.target);
    await delayed.finish(await refused(id) as never);
    await tick(4);
    expect(m.target.textContent).toContain(REFUSED);
    expect(refreshes()).toBe(0);
    expect(actions(m.target).disabled).toBe(false);
  });

  it('a refresh that rejects after a confirmed install keeps the receipt, says so and frees the row', async () => {
    const { m } = await mountAgents();
    navigationHooks.onInvalidateAll = () => { throw new Error('refresh failed after a confirmed install'); };
    const { id, delayed } = await beginInstall(m.target);
    await delayed.finish(await confirmed(id) as never);
    await tick(4);
    expect(m.target.textContent).toContain(LINKED);
    expect(m.target.textContent).toContain('could not be refreshed');
    expect(actions(m.target).disabled).toBe(false);
    expect(refreshes()).toBe(1);
  });

  // Superforms awaits between entering its result handler and applying the result, so a
  // fence at any one point leaves the rest open. Walk the App change across all of them.
  it('leaving A at any point while its answer is applied leaves B untouched (success, refusal, failed request)', async () => {
    const failed = async () => ({ type: 'error', status: 500, error: { message: 'boom' } });
    for (const [answer, text] of [[confirmed, LINKED], [refused, REFUSED], [failed, 'could not be confirmed']] as const) {
      const regimes = new Set<string>();
      for (let turns = 0; turns <= 12; turns += 1) {
        const { m, props } = await mountAgents();
        const { id, delayed } = await beginInstall(m.target);
        const result = await answer(id);
        const b = await dataFor('a2');
        resetNavigationCalls();
        const finishing = delayed.finish(result as never);
        for (let i = 0; i < turns; i += 1) await Promise.resolve();
        flushSync();
        regimes.add(m.target.textContent?.includes(text) ? 'shown-on-A' : 'not-yet-shown');
        const refreshedWhileOnA = refreshes();
        props.data = b;
        flushSync();
        const search = m.target.querySelector<HTMLInputElement>('input[aria-label="Search agents"]')!;
        search.focus();
        await finishing;
        await tick(4);
        const at = `${text} after ${turns} turns`;
        expect(m.target.textContent, at).not.toContain(text);
        expect(document.activeElement, at).toBe(search);
        expect(refreshes(), at).toBe(refreshedWhileOnA);
        expect(actions(m.target).disabled, at).toBe(false);
        m.unmount();
        mounted.pop();
      }
      // The walk only counts if it reached both sides of the result landing on A.
      expect([...regimes].sort(), text).toEqual(['not-yet-shown', 'shown-on-A']);
    }
  });

  const REDIRECT = { type: 'redirect', status: 303, location: '/signin' } as const;
  const FAILED = { type: 'error', status: 500, error: { message: 'boom' } } as const;
  const UNCONFIRMED = 'could not be confirmed';

  it('a redirect still reaches Kit in the current App (applyAction is off for this form)', async () => {
    const { m } = await mountAgents();
    const { delayed } = await beginInstall(m.target);
    await delayed.finish(REDIRECT as never);
    await tick(4);
    expect(kitAppliedResults).toEqual([REDIRECT]);
  });

  it('A’s late redirect does not reach Kit on B', async () => {
    const { m, props } = await mountAgents();
    const { delayed } = await beginInstall(m.target);
    props.data = await dataFor('a2');
    await tick(3);
    await delayed.finish(REDIRECT as never);
    await tick(4);
    expect(kitAppliedResults).toEqual([]);
    expect(actions(m.target).disabled).toBe(false);
  });

  it('a failed request says the install is unconfirmed, claims neither outcome and frees the row', async () => {
    const { m } = await mountAgents();
    const { delayed } = await beginInstall(m.target);
    await delayed.finish(FAILED as never);
    await tick(4);
    expect(m.target.textContent).toContain(UNCONFIRMED);
    expect(m.target.textContent).not.toContain(LINKED);
    expect(refreshes()).toBe(0);
    expect(actions(m.target).disabled).toBe(false);
  });

  it('A’s late failed request says nothing on B', async () => {
    const { m, props } = await mountAgents();
    const { delayed } = await beginInstall(m.target);
    props.data = await dataFor('a2');
    await tick(3);
    await delayed.finish(FAILED as never);
    await tick(4);
    expect(m.target.textContent).not.toContain(UNCONFIRMED);
    expect(actions(m.target).disabled).toBe(false);
  });

  it('a success or refusal never goes through Kit, so focus stays where the reader put it', async () => {
    for (const answer of [confirmed, refused]) {
      resetKitAppliedResults();
      const { m } = await mountAgents();
      const { id, delayed } = await beginInstall(m.target);
      const search = m.target.querySelector<HTMLInputElement>('input[aria-label="Search agents"]')!;
      search.focus();
      await delayed.finish(await answer(id) as never);
      await tick(4);
      expect(kitAppliedResults).toEqual([]);
      expect(document.activeElement).toBe(search);
    }
  });

  it('a refresh that rejects after the user left A says nothing on B', async () => {
    const { m, props } = await mountAgents();
    let reject!: (e: Error) => void;
    navigationHooks.onInvalidateAll = () => new Promise<void>((_, r) => { reject = r; });
    const { id, delayed } = await beginInstall(m.target);
    const finishing = delayed.finish(await confirmed(id) as never);
    await tick(4);
    props.data = await dataFor('a2');
    await tick(3);
    reject(new Error('refresh failed'));
    await finishing;
    await tick(4);
    expect(m.target.textContent).not.toContain(LINKED);
    expect(m.target.textContent).not.toContain('could not be refreshed');
    expect(actions(m.target).disabled).toBe(false);
  });

  // portal#1715 S3: DOM only, not a claim about what a screen reader announced.
  it('the stale-list notice arrives inside a status region already mounted, and clears on the next submit', async () => {
    const { m } = await mountAgents();
    const region = m.target.querySelector('[data-testid="install-refresh-status"]')!;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.textContent?.trim()).toBe('');
    navigationHooks.onInvalidateAll = () => { throw new Error('refresh failed after a confirmed install'); };
    const { id, delayed } = await beginInstall(m.target);
    await delayed.finish(await confirmed(id) as never);
    await tick(4);
    expect(m.target.querySelector('[data-testid="install-refresh-status"]')).toBe(region);
    expect(region.textContent).toContain('could not be refreshed');
    expect(region.textContent).not.toContain('Do not install again');
    expect(region.querySelector('[role="status"], [role="alert"], button')).toBeNull();
    navigationHooks.onInvalidateAll = undefined;
    await beginInstall(m.target);
    await tick(2);
    expect(region.textContent?.trim()).toBe('');
  });

  // portal#1715 S2: these banners had dark classes only, so a refusal was a dark block on a light page.
  it('the shared banners have a light and a dark look', async () => {
    const { m } = await mountAgents();
    const { id, delayed } = await beginInstall(m.target);
    await delayed.finish(await refused(id) as never);
    await tick(4);
    const alert = [...m.target.querySelectorAll('[role="alert"]')].find((x) => x.textContent?.includes(REFUSED))!;
    expect(alert.className.split(' ')).toEqual(expect.arrayContaining(['bg-red-50', 'text-red-700', 'dark:bg-red-950', 'dark:text-red-300']));
    const { id: next, delayed: again } = await beginInstall(m.target);
    await again.finish(await confirmed(next) as never);
    await tick(4);
    const status = [...m.target.querySelectorAll('[role="status"]')].find((x) => x.textContent?.includes(LINKED))!;
    expect(status.firstElementChild).not.toBeNull();
    expect(status.firstElementChild!.className.split(' ')).toEqual(expect.arrayContaining(['bg-green-50', 'text-green-700', 'dark:bg-green-950', 'dark:text-green-300']));
  });

  it('the stale-list notice leaves with the App', async () => {
    const { m, props } = await mountAgents();
    navigationHooks.onInvalidateAll = () => { throw new Error('refresh failed after a confirmed install'); };
    const { id, delayed } = await beginInstall(m.target);
    await delayed.finish(await confirmed(id) as never);
    await tick(4);
    const region = m.target.querySelector('[data-testid="install-refresh-status"]')!;
    expect(region.textContent).toContain('could not be refreshed');
    props.data = await dataFor('a2');
    await tick(4);
    expect(m.target.querySelector('[data-testid="install-refresh-status"]')!.textContent?.trim()).toBe('');
  });
});

// portal#1715 S1. Picker Link, row Install and row Unlink are three forms, and
// `multipleSubmits: 'prevent'` holds per form, so nothing but this invariant stops
// two writes at once. Each pin counts the submit events that left the page: a
// disabled attribute alone wouldn't show a write didn't go out, because the row's
// actions reach `requestSubmit()`, which ignores disabled controls.
describe('one agent write at a time on the Agents tab (portal#1715)', () => {
  const BETA = { id: 'ag1', urn: 'hrn:agent:acme.com:beta', name: 'Beta', personaRole: null };
  const DELTA = { id: 'ag3', urn: 'hrn:agent:acme.com:delta', name: 'Delta', personaRole: null };
  const GAMMA = { id: 'ag2', urn: 'hrn:agent:acme.com:gamma', name: 'Gamma' };
  const IMPORTER = { id: 'ag0', name: 'Alpha', urn: 'hrn:agent:acme.com:alpha' };
  async function mountAgents() {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: true, json: async () => String(url).includes('/customisation?') ? { list: { state: 'not-shown' }, original: { state: 'not-shown' }, replacement: { state: 'not-shown' } } : {} }) as Response));
    setStubPage('https://example.test/app/apps/a1?tab=agents', { appId: 'a1' });
    const data = await pageData();
    Object.assign(data.app, { agents: [BETA, DELTA] });
    data.initialTab = 'agents';
    const props = reactiveProps({
      data: { ...data, availableAgents: [GAMMA], bootPointerAppKey: 'a1', installMarks: { ag1: { kind: 'derived', importer: IMPORTER }, ag3: { kind: 'installed' } } },
      form: null,
    });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const writes: string[] = [];
    m.target.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const id = form.querySelector<HTMLInputElement>('[name="__superform_id"]')?.value ?? '';
      writes.push(id.startsWith('installAgent:') ? 'install' : form.getAttribute('action') === '?/removeAgent' ? 'unlink' : 'link');
    }, { capture: true });
    return { m, writes };
  }
  const forms = (target: HTMLElement) => [...target.querySelectorAll<HTMLFormElement>('form')];
  const installForm = (target: HTMLElement) => forms(target).find((f) => f.querySelector<HTMLInputElement>('[name="__superform_id"]')?.value.startsWith('installAgent:'))!;
  const linkForm = (target: HTMLElement) => forms(target).find((f) => f.getAttribute('action') === '?/addAgent' && !f.classList.contains('hidden'))!;
  const unlinkForm = (target: HTMLElement) => target.querySelector<HTMLFormElement>('form[action="?/removeAgent"]')!;
  const linkButton = (target: HTMLElement) => linkForm(target).querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const menu = (target: HTMLElement, name: string) => target.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${name}"]`)!;
  const item = (target: HTMLElement, label: string) => [...target.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find((i) => i.textContent?.trim() === label)!;
  async function pick(target: HTMLElement) {
    const select = linkForm(target).querySelector<HTMLSelectElement>('[name="agentId"]')!;
    select.value = 'ag2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
  }
  async function openItem(target: HTMLElement, name: string, label: string) {
    menu(target, name).click();
    flushSync();
    return item(target, label);
  }
  const answer = async (schema: typeof addAgentSchema | typeof removeAppAgentSchema, id: string) => {
    const f = await superValidate({ agentId: 'ag1' } as never, zod4(schema as typeof addAgentSchema), { errors: false, id });
    f.message = { type: 'success', text: 'Done.' };
    return { type: 'success' as const, status: 200, data: { form: f } };
  };
  const idOf = (form: HTMLFormElement) => form.querySelector<HTMLInputElement>('[name="__superform_id"]')?.value ?? 'x';

  // The menu closes on an outside click, so a first write started by clicking would
  // leave these clicks on a detached item, passing without ever reaching a guard.
  // `reached` proves the item is live; the first write starts with no outside click.
  const reached = (target: HTMLElement, el: HTMLElement) => expect(target.contains(el)).toBe(true);
  async function start(form: HTMLFormElement) {
    form.requestSubmit();
    const begun = await submitEnhancedDeferred(form);
    await tick(2);
    return begun;
  }

  it('picker to row: while Link is submitting, row Install can’t post', async () => {
    const { m, writes } = await mountAgents();
    await pick(m.target);
    const install = await openItem(m.target, 'Beta', 'Install');
    await start(linkForm(m.target));
    reached(m.target, install);
    install.click();
    await tick(3);
    expect(writes).toEqual(['link']);
    expect(menu(m.target, 'Beta').disabled).toBe(true);
    expect(linkButton(m.target).textContent?.trim()).toBe('Linking...');
  });

  it('picker to row: while Link is submitting, row Unlink can’t post', async () => {
    const { m, writes } = await mountAgents();
    await pick(m.target);
    const unlink = await openItem(m.target, 'Delta', 'Unlink');
    await start(linkForm(m.target));
    reached(m.target, unlink);
    unlink.click();
    await tick(3);
    expect(writes).toEqual(['link']);
  });

  it('row to picker: while row Install is submitting, Link can’t post', async () => {
    const { m, writes } = await mountAgents();
    await pick(m.target);
    (await openItem(m.target, 'Beta', 'Install')).click();
    await tick(2);
    expect(writes).toEqual(['install']);
    await submitEnhancedDeferred(installForm(m.target));
    await tick(2);
    linkButton(m.target).click();
    await tick(2);
    expect(writes).toEqual(['install']);
    expect(linkButton(m.target).disabled).toBe(true);
    expect(linkButton(m.target).textContent?.trim()).toBe('Link');
  });

  it('row to row: while row Install is submitting, row Unlink can’t post', async () => {
    const { m, writes } = await mountAgents();
    const unlink = await openItem(m.target, 'Delta', 'Unlink');
    await start(installForm(m.target));
    reached(m.target, unlink);
    unlink.click();
    await tick(3);
    expect(writes).toEqual(['install']);
  });

  it('while Unlink is submitting, neither Link nor row Install posts', async () => {
    const { m, writes } = await mountAgents();
    await pick(m.target);
    const install = await openItem(m.target, 'Beta', 'Install');
    await start(unlinkForm(m.target));
    reached(m.target, install);
    install.click();
    await tick(3);
    expect(writes).toEqual(['unlink']);
    linkButton(m.target).click();
    await tick(2);
    expect(writes).toEqual(['unlink']);
    expect(linkButton(m.target).disabled).toBe(true);
  });

  it('control: one write after another goes through once the first has answered', async () => {
    const { m, writes } = await mountAgents();
    await pick(m.target);
    const link = await start(linkForm(m.target));
    expect(linkButton(m.target).disabled).toBe(true);
    await link.finish(await answer(addAgentSchema, idOf(linkForm(m.target))) as never);
    await tick(4);
    expect(menu(m.target, 'Beta').disabled).toBe(false);
    (await openItem(m.target, 'Beta', 'Install')).click();
    await tick(2);
    expect(writes).toEqual(['link', 'install']);
  });
});

// #1776: real Superforms callbacks, held across a reused Page's App change.
describe('Link and Unlink answers belong to their App visit (#1776)', () => {
  const DELTA = { id: 'ag3', urn: 'hrn:agent:acme.com:delta', name: 'Delta', personaRole: null };
  const GAMMA = { id: 'ag2', urn: 'hrn:agent:acme.com:gamma', name: 'Gamma' };
  type Kind = 'link' | 'unlink';
  type Outcome = 'success' | 'refusal' | 'error' | 'redirect';
  async function dataFor(appId: string) {
    setStubPage(`https://example.test/app/apps/${appId}?tab=agents`, { appId });
    const data = await pageData();
    Object.assign(data.app, { id: appId, agents: [DELTA] });
    return { ...data, initialTab: 'agents', availableAgents: [GAMMA], bootPointerAppKey: appId,
      installMarks: { ag3: { kind: 'installed' } } };
  }
  async function mountAgents() {
    vi.stubGlobal('fetch', vi.fn(async url => ({ ok: true, json: async () => String(url).includes('/customisation?')
      ? { list: { state: 'not-shown' }, original: { state: 'not-shown' }, replacement: { state: 'not-shown' } } : {} }) as Response));
    const props = reactiveProps({ data: await dataFor('a1'), form: null });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(3);
    return { m, props };
  }
  const formOf = (target: HTMLElement, kind: Kind) => kind === 'unlink'
    ? target.querySelector<HTMLFormElement>('form[action="?/removeAgent"]')!
    : [...target.querySelectorAll<HTMLFormElement>('form[action="?/addAgent"]')].find(f => !f.classList.contains('hidden'))!;
  async function begin(target: HTMLElement, kind: Kind) {
    if (kind === 'link') {
      const select = formOf(target, kind).querySelector<HTMLSelectElement>('[name="agentId"]')!;
      select.value = GAMMA.id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await tick(2);
    } else {
      const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
      target.querySelector<HTMLButtonElement>('button[aria-label="Actions for Delta"]')!.click();
      flushSync();
      [...target.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el => el.textContent?.trim() === 'Unlink')!.click();
      await tick(2);
      expect(requestSubmit).toHaveBeenCalledTimes(1);
      expect(requestSubmit.mock.instances[0]).toBe(formOf(target, kind));
      requestSubmit.mockRestore();
    }
    const form = formOf(target, kind);
    // Main uses the loader's schema id without an explicit hidden field;
    // the fenced form exposes its live instance id. Derive the old id from
    // the same loader schema, never from an invented constant.
    const id = form.querySelector<HTMLInputElement>('[name="__superform_id"]')?.value
      ?? (await superValidate(zod4((kind === 'link' ? addAgentSchema : removeAppAgentSchema) as typeof addAgentSchema), { errors: false })).id;
    expect(new FormData(form).get('agentId')).toBe(kind === 'link' ? GAMMA.id : DELTA.id);
    return { id, delayed: await submitEnhancedDeferred(form), form };
  }
  it('#1777 shared success region is mounted empty, filled, then cleared without replacement', async () => {
    const { m, props } = await mountAgents();
    const region = m.target.querySelector('[data-testid="app-success-status"]');
    expect(region).not.toBeNull();
    expect(region!.textContent?.trim()).toBe('');
    expect(region!.getAttribute('role')).toBe('status');
    const a = await begin(m.target, 'link');
    await a.delayed.finish(await answer('link', 'success', a.id, 'A') as never);
    await tick(3);
    expect(m.target.querySelector('[data-testid="app-success-status"]')).toBe(region);
    expect(region!.textContent).toContain('A link success');
    props.data = await dataFor('a2');
    await tick(3);
    expect(m.target.querySelector('[data-testid="app-success-status"]')).toBe(region);
    expect(region!.textContent?.trim()).toBe('');
  });

  async function answer(kind: Kind, outcome: Outcome, id: string, owner: string) {
    if (outcome === 'error') return { type: 'error', status: 500, error: { message: `${owner} failed request` } };
    if (outcome === 'redirect') return { type: 'redirect', status: 303, location: `/${owner}-redirect` };
    const f = await superValidate({ agentId: kind === 'link' ? GAMMA.id : DELTA.id },
      zod4((kind === 'link' ? addAgentSchema : removeAppAgentSchema) as typeof addAgentSchema), { errors: false, id });
    f.valid = outcome === 'success';
    f.message = { type: outcome === 'success' ? 'success' : 'error', text: `${owner} ${kind} ${outcome}` };
    return { type: outcome === 'success' ? 'success' : 'failure', status: outcome === 'success' ? 200 : 400, data: { form: f } };
  }

  it('#1795 Link retains Runs through an overlapping old-URL refresh', async () => {
    const { m, props } = await mountAgents();
    const pending = await begin(m.target, 'link');
    let releaseRuns!: () => void;
    navigationHooks.onGoto = () => new Promise<void>((resolve) => { releaseRuns = resolve; });
    m.target.querySelector<HTMLButtonElement>('#tab-runs')!.click();
    await tick(2);

    const order: string[] = [];
    let releaseRefresh!: () => void;
    navigationHooks.onInvalidateAll = () => {
      order.push('refresh-requested');
      return new Promise<void>((resolve) => { releaseRefresh = resolve; });
    };
    const finishing = pending.delayed.finish(await answer('link', 'success', pending.id, 'A') as never);
    await tick(4);
    order.push('runs-response');
    props.data = { ...props.data, initialTab: 'runs', runsPanel: await runsPanel('held-link-run') };
    await tick(3);
    releaseRuns();
    await tick(20);
    expect(releaseRefresh).toBeTypeOf('function');

    props.data = { ...props.data, initialTab: 'agents', runsPanel: null };
    releaseRefresh();
    await finishing;
    await tick(6);

    expect(m.target.querySelector('#panel-runs')?.textContent).toContain('held-link-run');
    expect(m.target.querySelector('#panel-runs')?.textContent).not.toContain('Loading runs…');
    expect(order).toEqual(['refresh-requested', 'runs-response']);
    expect(navigationCalls.filter((call) => call.fn === 'invalidateAll')).toHaveLength(1);
  });

  it('#1795 retains Runs when an Unlink refresh began BEFORE the tab click', async () => {
    const { m, props } = await mountAgents();
    const pending = await begin(m.target, 'unlink');
    const order: string[] = [];
    let releaseRefresh!: () => void;
    navigationHooks.onInvalidateAll = () => {
      order.push('refresh-requested');
      return new Promise<void>((resolve) => { releaseRefresh = resolve; });
    };
    const finishing = pending.delayed.finish(await answer('unlink', 'success', pending.id, 'A') as never);
    await tick(4);
    expect(releaseRefresh).toBeTypeOf('function');

    let releaseRuns!: () => void;
    navigationHooks.onGoto = () => new Promise<void>((resolve) => { releaseRuns = resolve; });
    m.target.querySelector<HTMLButtonElement>('#tab-runs')!.click();
    await tick(2);
    order.push('runs-response');
    props.data = { ...props.data, initialTab: 'runs', runsPanel: await runsPanel('held-unlink-run') };
    await tick(3);
    releaseRuns();
    await tick(20);

    // The older Agents-URL refresh lands last. No per-action navigation wait
    // can cover this inverse ordering; the page must retain its Runs payload.
    props.data = { ...props.data, initialTab: 'agents', runsPanel: null };
    releaseRefresh();
    await finishing;
    await tick(6);

    expect(m.target.querySelector('#panel-runs')?.textContent).toContain('held-unlink-run');
    expect(m.target.querySelector('#panel-runs')?.textContent).not.toContain('Loading runs…');
    expect(order).toEqual(['refresh-requested', 'runs-response']);
  });

  async function move(props: { data: Awaited<ReturnType<typeof dataFor>> }, appId: string) {
    props.data = await dataFor(appId);
    await tick(3);
    // Superforms makes B available after a real router navigation; without
    // this hook a pending A request can vacuously keep B from submitting.
    for (const g of navigationGuards.filter(g => g.fn === 'afterNavigate'))
      (g.callback as (nav: unknown) => void)({ type: 'link' });
    await tick(3);
  }
  for (const kind of ['link', 'unlink'] as const) {
    for (const bSubmitted of [false, true]) {
      it.each(['success', 'refusal', 'error', 'redirect'] as const)(`${kind}: late %s stays off B (B submitted=${bSubmitted})`, async outcome => {
        const { m, props } = await mountAgents();
        const a = await begin(m.target, kind);
        await move(props, 'a2');
        const b = bSubmitted ? await begin(m.target, kind) : null;
        resetNavigationCalls();
        resetKitAppliedResults();
        const focus = m.target.querySelector<HTMLSelectElement>('#agentId')!;
        focus.focus();
        await a.delayed.finish(await answer(kind, outcome, a.id, 'A') as never);
        await tick(4);
        expect(m.target.textContent).not.toContain(`A ${kind}`);
        expect(kitAppliedResults).toEqual([]);
        expect(navigationCalls.filter(c => c.fn === 'invalidateAll')).toHaveLength(0);
        expect(document.activeElement).toBe(focus);
        if (b) {
          // Same post-navigation lifecycle position: a dead delivery wire must
          // fail this control even if every stale-answer negative passes.
          await b.delayed.finish(await answer(kind, 'refusal', b.id, 'B') as never);
          await tick(4);
          expect(m.target.textContent).toContain(`B ${kind} refusal`);
        }
      });
    }
    it.each(['message', 'fields'] as const)(`${kind}: completed A %s and selection clear on App change`, async state => {
      const { m, props } = await mountAgents();
      const selection = () => kind === 'link'
        ? formOf(m.target, kind).querySelector<HTMLSelectElement>('[name="agentId"]')!.value
        : formOf(m.target, kind).querySelector<HTMLInputElement>('[name="agentId"]')!.value;
      async function completed(owner: string) {
        if (state === 'fields') {
          const form = formOf(m.target, kind);
          if (kind === 'link') {
            // Link has novalidate: reproduce the action's validation of the
            // exact empty submitted FormData, including its live form id.
            const body = new FormData(form);
            const delayed = await submitEnhancedDeferred(form);
            const f = await superValidate(body, zod4(addAgentSchema));
            expect(f.valid).toBe(false);
            await delayed.finish({ type: 'failure', status: 400, data: { form: f } });
          } else {
            // Unlink validates its empty target on the client before sending.
            expect((await submitEnhanced(form)).cancelled).toBe(true);
          }
          await vi.waitFor(() => expect(m.target.textContent).toContain('Agent is required'));
        } else {
          const sent = await begin(m.target, kind);
          const f = await superValidate({ agentId: kind === 'link' ? GAMMA.id : DELTA.id },
            zod4((kind === 'link' ? addAgentSchema : removeAppAgentSchema) as typeof addAgentSchema), { id: sent.id });
          f.message = { type: 'error', text: `${owner} completed ${kind} answer` };
          await sent.delayed.finish({ type: 'failure', status: 500, data: { form: f } });
          await tick(3);
        }
      }
      const expected = state === 'fields' ? 'Agent is required' : `A completed ${kind} answer`;
      await completed('A');
      expect(m.target.textContent).toContain(expected);
      expect(selection()).toBe(state === 'fields' ? '' : kind === 'link' ? GAMMA.id : DELTA.id);
      await move(props, 'a2');
      expect(m.target.textContent).not.toContain(expected);
      expect(selection()).toBe('');
      await completed('B');
      expect(m.target.textContent).toContain(state === 'fields' ? 'Agent is required' : `B completed ${kind} answer`);
    });
    it(`${kind}: returning A is a new visit, not the old pending request`, async () => {
      const { m, props } = await mountAgents();
      const a = await begin(m.target, kind);
      await move(props, 'a2');
      await move(props, 'a1');
      const current = await begin(m.target, kind);
      resetKitAppliedResults();
      await a.delayed.finish(await answer(kind, 'refusal', a.id, 'OLD') as never);
      await tick(3);
      expect(m.target.textContent).not.toContain(`OLD ${kind}`);
      expect(kitAppliedResults).toEqual([]);
      await current.delayed.finish(await answer(kind, 'refusal', current.id, 'CURRENT') as never);
      await tick(3);
      expect(m.target.textContent).toContain(`CURRENT ${kind} refusal`);
    });
    it(`${kind}: an App change during the successful refresh cannot rebind B`, async () => {
      const { m, props } = await mountAgents();
      const a = await begin(m.target, kind);
      let reached = false;
      navigationHooks.onInvalidateAll = async () => {
        reached = true;
        await move(props, 'a2');
        const select = formOf(m.target, 'link').querySelector<HTMLSelectElement>('[name="agentId"]')!;
        select.value = GAMMA.id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await tick(2);
        select.focus();
      };
      await a.delayed.finish(await answer(kind, 'success', a.id, 'A') as never);
      await tick(4);
      expect(reached).toBe(true);
      expect(m.target.textContent).not.toContain(`A ${kind}`);
      const select = formOf(m.target, 'link').querySelector<HTMLSelectElement>('[name="agentId"]')!;
      expect(select.value).toBe(GAMMA.id);
      expect(document.activeElement).toBe(select);
      expect(kitAppliedResults).toEqual([]);
    });
    it(`${kind}: a fresh mount cannot receive the destroyed page's answer`, async () => {
      const first = await mountAgents();
      const a = await begin(first.m.target, kind);
      first.m.unmount();
      mounted.splice(mounted.indexOf(first.m), 1);
      const fresh = await mountAgents();
      const current = await begin(fresh.m.target, kind);
      resetKitAppliedResults();
      await a.delayed.finish(await answer(kind, 'refusal', a.id, 'OLD') as never);
      await tick(3);
      expect(fresh.m.target.textContent).not.toContain(`OLD ${kind}`);
      expect(kitAppliedResults).toEqual([]);
      await current.delayed.finish(await answer(kind, 'refusal', current.id, 'CURRENT') as never);
      await tick(3);
      expect(fresh.m.target.textContent).toContain(`CURRENT ${kind} refusal`);
    });
    it(`${kind}: B own failed request keeps its existing error handling`, async () => {
      const { m, props } = await mountAgents();
      await begin(m.target, kind);
      await move(props, 'a2');
      const b = await begin(m.target, kind);
      await expect(b.delayed.finish(await answer(kind, 'error', b.id, 'B') as never))
        .rejects.toMatchObject({ message: 'B failed request' });
    });
    it.each(['success', 'refusal', 'redirect'] as const)(`${kind}: B own %s still lands after navigation`, async outcome => {
      const { m, props } = await mountAgents();
      await begin(m.target, kind);
      await move(props, 'a2');
      const b = await begin(m.target, kind);
      resetKitAppliedResults();
      resetNavigationCalls();
      await b.delayed.finish(await answer(kind, outcome, b.id, 'B') as never);
      await tick(4);
      if (outcome === 'redirect') expect(kitAppliedResults).toEqual([{ type: 'redirect', status: 303, location: '/B-redirect' }]);
      else expect(m.target.textContent).toContain(`B ${kind} ${outcome}`);
    });
  }
});

// #2170 F6: an inconclusive deep-link lookup is not a failed chat list.
describe('App chats: deep-link uncertainty vs chat-list failure', () => {
  async function mountChats(overrides: Record<string, unknown>) {
    setStubPage('https://example.test/app/apps/a1?tab=chats', { appId: 'a1' });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ items: [], total: 0, workers: [], loadFailed: false }),
    }) as Response));
    const data = { ...(await pageData()), ...overrides };
    const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    return m.target;
  }
  const DEEP_LINK = 'Couldn’t find the linked chat in this App — pick it from the list.';
  const DISCOVERY = 'Could not load this App’s chat list';

  it('says the linked chat could not be found, not that the list failed', async () => {
    const t = await mountChats({ chatsError: false, chatDeepLinkUnresolved: true });
    expect(t.textContent).toContain(DEEP_LINK);
    expect(t.textContent).not.toContain(DISCOVERY);
  });

  it('a real chat-list failure keeps the discovery message (control)', async () => {
    const t = await mountChats({ chatsError: true, chatDeepLinkUnresolved: false });
    expect(t.textContent).toContain(DISCOVERY);
    expect(t.textContent).not.toContain(DEEP_LINK);
  });
});
