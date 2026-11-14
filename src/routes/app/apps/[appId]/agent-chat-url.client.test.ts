import { afterEach, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { navigationCalls, navigationGuards, resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { AGENT_CHAT_KEY, TEAM_CHAT_LOC, buildAppChatList } from '$lib/app-chats';
import { pageData } from './app-page.fixture';
import Page from './+page.svelte';

const loc = 'chats:legacy-personal';
const personal = { id: 'personal', loc, title: 'Personal fixture', conversationName: 'Private stage', stageName: null,
  messageCount: 0, createdAt: '', lastMessageAt: null, scope: 'private', createdBy: null };
let mounted: ReturnType<typeof mountComponent> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); resetNavigationCalls(); resetNavigationGuards(); });

async function open(query: string, flags: { missing?: boolean; failed?: boolean; capped?: boolean; selected?: string } = {}) {
  const href = `/app/apps/a1?tab=chats&${query}`;
  setStubPage(`https://example.test${href}`, { appId: 'a1' }); window.history.replaceState({}, '', href);
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input); calls.push(url);
    const body = url.includes('/api/agent-chat/list') ? { chats: [personal] }
      : url.includes('/api/agent-chat/resume') ? { chat: personal, messages: [] }
      : url.includes('/api/served-prompts') ? { items: [], total: 0, offset: 0 }
      : (() => { throw new Error(`Unexpected fetch ${url}`); })();
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  }));
  // The recorder intentionally has no History API behavior; apply its URL writes
  // to the shared page store as Kit does, so the parent observes shallow changes.
  const push = navigationCalls.push.bind(navigationCalls);
  vi.spyOn(navigationCalls, 'push').mockImplementation((...entries) => {
    for (const e of entries) if (e.fn === 'replaceState') {
      const url = String(e.args[0]); window.history.replaceState({}, '', url); setStubPage(url, { appId: 'a1' });
    }
    return push(...entries);
  });
  const base = await pageData();
  const data = { ...base, app: { ...base.app, surfaces: ['chat'], agentId: 'ag1' }, chatConfigs: null,
    appChats: buildAppChatList([{ loc: 'chats:shared', name: 'Shared fixture', memoryId: 'shared' }], { hasAgentChat: true }),
    selectedChatKey: flags.selected ?? AGENT_CHAT_KEY, chatNotFound: flags.missing ?? true,
    chatsError: flags.failed ?? false, chatsCapped: flags.capped ?? false };
  const props = reactiveProps({ data, form: null });
  mounted = mountComponent(Page as never, props as never);
  await tick(3);
  return { calls, props, target: mounted.target };
}

it('recovers a legacy personal URL, canonicalizes it and clears the parent missing banner', async () => {
  const { calls, props, target } = await open(`chat=${encodeURIComponent(loc)}&keep=yes#anchor`);
  await vi.waitFor(() => expect(calls.some(c => c.includes('/resume'))).toBe(true));
  await vi.waitFor(() => expect(target.textContent).toContain('Private stage'));
  expect(target.textContent).not.toContain('That chat isn’t available');
  const url = new URL(window.location.href);
  expect(url.searchParams.get('chat')).toBe(AGENT_CHAT_KEY);
  expect(url.searchParams.get('agentChat')).toBe(loc);
  expect(url.searchParams.get('keep')).toBe('yes'); expect(url.hash).toBe('#anchor');
  props.data = { ...props.data }; await tick(3); // stale loader data from an invalidation cannot restore the banner
  expect(target.textContent).not.toContain('That chat isn’t available');
});

it.each([{ failed: true }, { capped: true }])('does not recover an unproven selector when discovery is incomplete: %j', async (flags) => {
  const { calls, target } = await open(`chat=${encodeURIComponent(loc)}`, flags);
  await vi.waitFor(() => expect(target.textContent).toContain('Personal fixture'));
  await tick(3);
  expect(calls.some(c => c.includes('/resume'))).toBe(false);
  expect(new URL(window.location.href).searchParams.get('chat')).toBe(loc);
  expect(target.textContent).toContain('That chat isn’t available');
});

it('removes the personal residue when the real selector switches to Team or a shared chat', async () => {
  const { target } = await open(`chat=agent+chat&agentChat=${encodeURIComponent(loc)}&keep=yes#anchor`, { missing: false });
  await vi.waitFor(() => expect(target.textContent).toContain('Private stage'));
  for (const key of [TEAM_CHAT_LOC, 'chats:shared']) {
    const select = target.querySelector<HTMLSelectElement>('#app-chat-select')!;
    select.value = key; select.dispatchEvent(new Event('change', { bubbles: true })); await tick(3);
    const call = navigationCalls.filter(c => c.fn === 'goto').at(-1);
    expect(call).toBeDefined(); const url = new URL(String(call!.args[0]));
    expect(url.searchParams.get('chat')).toBe(key); expect(url.searchParams.has('agentChat')).toBe(false);
    expect(url.searchParams.get('keep')).toBe('yes'); expect(url.hash).toBe('#anchor');
  }
});

it('cleans residue on arrival at a known Team selector without resuming a personal chat', async () => {
  const { calls } = await open(`chat=chats%3Ateam&agentChat=${encodeURIComponent(loc)}&keep=yes#anchor`, { missing: false, selected: TEAM_CHAT_LOC });
  const after = navigationGuards.find(g => g.fn === 'afterNavigate')?.callback as (nav: {type: string}) => void;
  expect(after).toBeDefined(); after({ type: 'enter' }); await tick(3);
  const url = new URL(window.location.href);
  expect(url.searchParams.has('agentChat')).toBe(false); expect(url.searchParams.get('chat')).toBe(TEAM_CHAT_LOC);
  expect(url.searchParams.get('keep')).toBe('yes'); expect(url.hash).toBe('#anchor');
  expect(calls.some(c => c.includes('/api/agent-chat/resume'))).toBe(false);
});
