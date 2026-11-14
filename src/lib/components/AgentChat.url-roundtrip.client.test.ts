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
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input); calls.push(path);
    const body = path.includes('/list') ? { chats: [persisted] }
      : path.includes('/resume') ? { chat: persisted, messages: [] }
      : path.includes('/start') ? { chatId: loc, conversationName: null, stageName: null, scope: 'private' } : {};
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}
afterEach(() => { vi.unstubAllGlobals(); resetNavigationCalls(); });

describe('portal#2107: App AgentChat URL round trip', () => {
  it('its emitted URL reloads the agent entry even when a shared root has the same loc', async () => {
    resetNavigationCalls(); stub();
    window.history.replaceState({}, '', '/app/apps/app?tab=chats&chat=agent+chat&keep=yes');
    const m = mountComponent(AgentChat, { agentId: 'agent', appId: 'app' });
    await wait(30);
    const button = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('New chat'))!;
    button.click(); await wait(40);
    const emitted = navigationCalls.filter(c => c.fn === 'replaceState').at(-1);
    expect(emitted).toBeDefined();
    const url = new URL(String(emitted!.args[0]));
    expect(resolveSelectedChat(entries, url.searchParams.get('chat'))).toEqual({ selected: entries[0], requestedMissing: false });
    expect(url.searchParams.get('chat')).toBe(AGENT_CHAT_KEY);
    expect(url.searchParams.get('agentChat')).toBe(loc);
    expect(url.searchParams.get('keep')).toBe('yes');
    m.unmount();
    window.history.replaceState({}, '', url);
    const calls = stub();
    const reloaded = mountComponent(AgentChat, { agentId: 'agent', appId: 'app' });
    await wait(40);
    expect(calls.filter(c => c.includes('/resume'))).toHaveLength(1);
    expect(calls.find(c => c.includes('/resume'))).toContain(encodeURIComponent(loc));
    reloaded.unmount();
  });

  it.each([loc, TEAM_CHAT_LOC, 'gone'])('does not reinterpret another App selector %s as a personal chat', async (selected) => {
    resetNavigationCalls(); const calls = stub();
    window.history.replaceState({}, '', `/app/apps/app?chat=${encodeURIComponent(selected)}&agentChat=${encodeURIComponent(loc)}`);
    const m = mountComponent(AgentChat, { agentId: 'agent', appId: 'app' });
    await wait(40);
    expect(calls.some(c => c.includes('/resume'))).toBe(false);
    expect(navigationCalls.filter(c => c.fn === 'replaceState')).toEqual([]);
    if (selected === 'gone') expect(resolveSelectedChat(entries, selected).requestedMissing).toBe(true);
    m.unmount();
  });

  it('never resumes an unreadable agent loc outside the filtered list', async () => {
    resetNavigationCalls(); const calls = stub();
    window.history.replaceState({}, '', '/app/apps/app?chat=agent+chat&agentChat=unreadable');
    const m = mountComponent(AgentChat, { agentId: 'agent', appId: 'app' });
    await wait(40);
    expect(calls.some(c => c.includes('/resume'))).toBe(false);
    const cleared = new URL(String(navigationCalls.find(c => c.fn === 'replaceState')!.args[0]));
    expect(cleared.searchParams.get('chat')).toBe(AGENT_CHAT_KEY);
    expect(cleared.searchParams.has('agentChat')).toBe(false);
    m.unmount();
  });
});
