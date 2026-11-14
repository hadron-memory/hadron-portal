import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, wait } from '$lib/test/mountComponent';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { AGENT_CHAT_KEY, TEAM_CHAT_LOC, buildAppChatList, resolveSelectedChat } from '$lib/app-chats';
import AgentChat from './AgentChat.svelte';

const loc = 'chats:same-loc';
const persisted = { id: 'personal-chat', loc, title: 'Personal', conversationName: null, stageName: null,
  messageCount: 0, createdAt: '', lastMessageAt: null, scope: 'private', createdBy: null };
const entries = buildAppChatList([{ loc, name: 'Shared', memoryId: 'shared-memory' }], { hasAgentChat: true });
function stub() {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/resume')) bodies.push(JSON.parse(String(init?.body)));
    const path = String(input); calls.push(path);
    const body = path.includes('/list') ? { chats: [persisted] }
      : path.includes('/resume') ? { chat: persisted, messages: [] }
      : path.includes('/start') ? { chatId: loc, conversationName: null, stageName: null, scope: 'private' }
      : (() => { throw new Error(`Unexpected fetch: ${path}`); })();
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  }));
  return { calls, bodies };
}
afterEach(() => { vi.unstubAllGlobals(); resetNavigationCalls(); });

describe('portal#2107: App AgentChat URL round trip', () => {
  it('its emitted URL reloads the agent entry even when a shared root has the same loc', async () => {
    resetNavigationCalls(); stub();
    window.history.replaceState({}, '', '/app/apps/app?tab=settings&chat=agent+chat&keep=yes');
    const m = mountComponent(AgentChat, { agentId: 'agent', appId: 'app' });
    await vi.waitFor(() => expect(document.body.textContent).toContain('Personal'));
    const button = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('New chat'))!;
    button.click();
    await vi.waitFor(() => expect(navigationCalls.some(c => c.fn === 'replaceState')).toBe(true));
    const emitted = navigationCalls.filter(c => c.fn === 'replaceState').at(-1);
    expect(emitted).toBeDefined();
    const url = new URL(String(emitted!.args[0]));
    expect(resolveSelectedChat(entries, url.searchParams.get('chat'))).toEqual({ selected: entries[0], requestedMissing: false });
    expect(url.searchParams.get('chat')).toBe(AGENT_CHAT_KEY);
    expect(url.searchParams.get('agentChat')).toBe(loc);
    expect(url.searchParams.get('keep')).toBe('yes');
    expect(url.searchParams.get('tab')).toBe('chats');
    m.unmount();
    window.history.replaceState({}, '', url);
    const { calls, bodies } = stub();
    const reloaded = mountComponent(AgentChat, { agentId: 'agent', appId: 'app' });
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(calls.filter(c => c.includes('/resume'))).toHaveLength(1);
    expect(bodies).toEqual([{ agentId: 'agent', chatId: loc }]);
    reloaded.unmount();
  });

  it.each([loc, TEAM_CHAT_LOC, 'gone'])('does not reinterpret another App selector %s as a personal chat', async (selected) => {
    resetNavigationCalls(); const { calls } = stub();
    window.history.replaceState({}, '', `/app/apps/app?chat=${encodeURIComponent(selected)}&agentChat=${encodeURIComponent(loc)}`);
    const m = mountComponent(AgentChat, { agentId: 'agent', appId: 'app' });
    await wait(40);
    expect(calls.some(c => c.includes('/resume'))).toBe(false);
    expect(navigationCalls.filter(c => c.fn === 'replaceState')).toEqual([]);
    if (selected === 'gone') expect(resolveSelectedChat(entries, selected).requestedMissing).toBe(true);
    m.unmount();
  });

  it('never resumes an unreadable agent loc outside the filtered list', async () => {
    resetNavigationCalls(); const { calls } = stub();
    window.history.replaceState({}, '', '/app/apps/app?chat=agent+chat&agentChat=unreadable');
    const m = mountComponent(AgentChat, { agentId: 'agent', appId: 'app' });
    await wait(40);
    expect(calls.some(c => c.includes('/resume'))).toBe(false);
    const cleared = new URL(String(navigationCalls.find(c => c.fn === 'replaceState')!.args[0]));
    expect(cleared.searchParams.get('chat')).toBe(AGENT_CHAT_KEY);
    expect(cleared.searchParams.has('agentChat')).toBe(false);
    expect(document.body.textContent).toContain('That chat isn’t available');
    m.unmount();
  });
  it('preserves a valid agent URL if its filtered list fails to load', async () => {
    resetNavigationCalls();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    window.history.replaceState({}, '', '/app/apps/app?chat=agent+chat&agentChat=chats%3Asame-loc');
    const m = mountComponent(AgentChat, { agentId: 'agent', appId: 'app' });
    await wait(40);
    expect(navigationCalls.filter(c => c.fn === 'replaceState')).toEqual([]);
    expect(document.body.textContent).toContain('Failed to load chats');
    m.unmount();
  });

  it('cannot clear the App URL after unmount while the list is in flight', async () => {
    resetNavigationCalls();
    let release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    vi.stubGlobal('fetch', vi.fn(async () => { await held; return new Response('{"chats":[]}'); }));
    window.history.replaceState({}, '', '/app/apps/app?chat=agent+chat&agentChat=gone');
    const m = mountComponent(AgentChat, { agentId: 'agent', appId: 'app' });
    m.unmount(); release(); await wait(40);
    expect(navigationCalls.filter(c => c.fn === 'replaceState')).toEqual([]);
  });

});
