import { afterEach, describe, expect, it, vi } from 'vitest';
import { startNewChat } from '$lib/test/startNewChat';
import { mountComponent, wait, tick, captureUnhandledRejections } from '$lib/test/mountComponent';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { AGENT_CHAT_KEY, TEAM_CHAT_LOC, buildAppChatList, resolveSelectedChat } from '$lib/app-chats';
import AgentChat from './AgentChat.svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';

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
    startNewChat();
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

  it('retains the non-App raw-chat URL round trip', async () => {
    resetNavigationCalls(); const { bodies } = stub();
    window.history.replaceState({}, '', `/app/agents/agent?chat=${encodeURIComponent(loc)}&keep=yes#anchor`);
    const m = mountComponent(AgentChat, { agentId: 'agent' });
    await vi.waitFor(() => expect(bodies).toEqual([{ agentId: 'agent', chatId: loc }]));
    const url = new URL(window.location.href);
    expect(url.searchParams.get('chat')).toBe(loc); expect(url.searchParams.has('agentChat')).toBe(false);
    expect(url.searchParams.get('keep')).toBe('yes'); expect(url.hash).toBe('#anchor');
    expect(navigationCalls.filter(c => c.fn === 'replaceState')).toEqual([]);
    m.unmount();
  });

  it.each(['alive', 'unmounted', 'other-app'])('guards legacy recovery completion against lifecycle changes: %s', async (state) => {
    resetNavigationCalls();
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    let read!: () => void; const decoded = new Promise<void>(r => { read = r; });
    const resolved = vi.fn(); let resumed = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/list')) return new Response(JSON.stringify({ chats: [persisted] }));
      if (String(input).includes('/resume')) {
        resumed = true; await gate;
        const response = new Response(JSON.stringify({ chat: persisted, messages: [] }));
        const json = response.json.bind(response);
        response.json = async () => { const body = await json(); read(); return body; };
        return response;
      }
      throw new Error(`Unexpected fetch ${input}`);
    }));
    window.history.replaceState({}, '', `/app/apps/app?chat=${encodeURIComponent(loc)}`);
    const props = reactiveProps({ agentId: 'agent', appId: 'app', allowLegacyAppChat: true, onLegacyChatResolved: resolved });
    const errors = await captureUnhandledRejections(async () => {
      const m = mountComponent(AgentChat, props);
      try {
        await vi.waitFor(() => expect(resumed).toBe(true));
        if (state === 'unmounted') m.unmount();
        if (state === 'other-app') props.appId = 'other-app';
        release(); await decoded; await tick(6);
        if (state === 'alive') expect(resolved).toHaveBeenCalledExactlyOnceWith('app');
        else expect(resolved).not.toHaveBeenCalled();
      } finally { m.unmount(); }
    });
    expect(errors).toEqual([]);
  });

  it.each(['app', 'agent', 'selector'])('does not recover from an outgoing filtered list when its %s changes', async (changed) => {
    resetNavigationCalls();
    let release!: () => void; const held = new Promise<void>(r => { release = r; });
    let decoded!: () => void; const read = new Promise<void>(r => { decoded = r; });
    let requested = false; let resumed = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/list')) {
        requested = true; await held;
        return { ok: true, json: async () => { decoded(); return { chats: [persisted, { ...persisted, loc: 'chats:next' }] }; } } as Response;
      }
      resumed = true; throw new Error(`Unexpected outgoing-list resume ${input}`);
    }));
    window.history.replaceState({}, '', `/app/apps/app?chat=${encodeURIComponent(loc)}`);
    const props = reactiveProps({ agentId: 'agent', appId: 'app', allowLegacyAppChat: true });
    const m = mountComponent(AgentChat, props);
    try {
      await vi.waitFor(() => expect(requested).toBe(true));
      if (changed === 'app') props.appId = 'next-app';
      else if (changed === 'agent') props.agentId = 'next-agent';
      else window.history.replaceState({}, '', '/app/apps/app?chat=chats%3Anext');
      release(); await read; await tick(6);
      expect(resumed).toBe(false);
      expect(navigationCalls.filter(c => c.fn === 'replaceState')).toEqual([]);
    } finally { m.unmount(); }
  });

  it('emits the existing raw-chat URL when starting a non-App chat', async () => {
    resetNavigationCalls(); stub();
    window.history.replaceState({}, '', '/app/agents/agent?keep=yes#anchor');
    const m = mountComponent(AgentChat, { agentId: 'agent' });
    try {
      await vi.waitFor(() => expect(m.target.textContent).toContain('Personal'));
      expect(m.target.querySelector('button[aria-label="New chat"]')).not.toBeNull(); startNewChat('private', m.target);
      await vi.waitFor(() => expect(navigationCalls.some(c => c.fn === 'replaceState')).toBe(true));
      const call = navigationCalls.filter(c => c.fn === 'replaceState').at(-1)!;
      const url = new URL(String(call.args[0]));
      expect(url.searchParams.get('chat')).toBe(loc); expect(url.searchParams.has('agentChat')).toBe(false);
      expect(url.searchParams.get('keep')).toBe('yes'); expect(url.hash).toBe('#anchor');
    } finally { m.unmount(); }
  });

});
