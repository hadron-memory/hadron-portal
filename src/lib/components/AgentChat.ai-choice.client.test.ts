import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, wait } from '$lib/test/mountComponent';
import AgentChat from './AgentChat.svelte';
import type { ChatAiChoiceOption } from '$lib/chat-ai-choice';

/**
 * portal#1963: the chatbot model dropdown (hadron-server#3957).
 *
 *  - It lists the server's choices; a new chat preselects the App's chatbot config.
 *  - A reopened chat shows the choice stored with it.
 *  - A choice is sent (and so stored) only once the user makes one; until then the
 *    chat runs the preselected config by name and sends no `aiConfigChoice`, as today.
 *  - A config the portal can't run is shown disabled with its reason.
 */
const opt = (o: Partial<ChatAiChoiceOption> & { value: string; name: string }): ChatAiChoiceOption => ({
  provider: 'anthropic', model: 'm', isDefault: false, isAppChatbotConfig: false, unavailableReason: null, ...o,
});
const CHOICES: ChatAiChoiceOption[] = [
  opt({ value: 'default', name: 'default', provider: null, model: null, isDefault: true }),
  opt({ value: 'cfg-fast', name: 'fast', model: 'haiku' }),
  opt({ value: 'cfg-smart', name: 'smart', model: 'opus', isAppChatbotConfig: true }),
  opt({ value: 'cfg-custom', name: 'custom', model: 'k2', unavailableReason: "can't run in portal chats yet" }),
];

const bodies: Array<{ url: string; body: Record<string, unknown> }> = [];
function stub(stored: string | null = null) {
  bodies.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    bodies.push({ url: url.replace(/\?.*/, ''), body });
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/api/agent-chat/list')) {
      return json({ chats: [{ id: 'n-old', loc: 'chats:old', title: 'Old', conversationName: null, stageName: null, messageCount: 1, scope: 'private', aiConfigChoice: stored }] });
    }
    if (url.includes('/api/agent-chat/start')) {
      return json({ chatId: 'chats:c1', conversationName: 'c', stageName: 's', welcomeMessage: null, welcomeError: null, scope: 'private' });
    }
    if (url.includes('/api/agent-chat/resume')) {
      return json({ chat: { title: 'Old', conversationName: null, stageName: null, scope: 'private', aiConfigChoice: stored }, messages: [], hasOlder: false });
    }
    if (url.includes('/api/agent-chat/turn')) return json({ assistantMessage: 'ok' });
    return json({});
  }));
}
const select = () => document.querySelector('select#agent-chat-ai-config') as HTMLSelectElement | null;
const clickButton = (re: RegExp) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''))!.click();
async function send(text: string) {
  const box = document.querySelector('textarea') as HTMLTextAreaElement;
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
  const before = calls('/api/agent-chat/turn');
  clickButton(/send/i);
  await until(() => calls('/api/agent-chat/turn') > before, 'the turn to be sent');
}
async function newChat() {
  const before = calls('/api/agent-chat/start');
  clickButton(/New chat/);
  await until(() => calls('/api/agent-chat/start') > before, 'the new chat to start');
  // The start RESPONSE has landed once the composer is usable (it needs an active chat id).
  await until(() => (document.querySelector('textarea') as HTMLTextAreaElement | null)?.disabled === false, 'the new chat to become active');
}
const calls = (path: string) => bodies.filter((b) => b.url === path).length;
/**
 * Poll for the awaited state instead of sleeping a fixed time (portal#2005, #2003 F5): a fixed delay
 * passes on a fast machine and flakes on a slow one, and says nothing about what it waited for.
 */
async function until(ready: () => boolean, what: string, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${ms}ms waiting for ${what}`);
    await wait(5);
  }
  await tick();
}
const listLoaded = () => until(() => calls('/api/agent-chat/list') > 0, 'the chat list to load');
const last = (path: string) => [...bodies].reverse().find((b) => b.url === path)!.body;

afterEach(() => { vi.unstubAllGlobals(); });

describe('AgentChat: the AI config dropdown (#1963)', () => {
  it('lists the choices and preselects the App chatbot config', async () => {
    stub();
    const m = mountComponent(AgentChat, { agentId: 'a1', appId: 'app-1', aiChoices: CHOICES });
    await listLoaded();
    const s = select()!;
    expect([...s.options].map((o) => o.value)).toEqual(['default', 'cfg-fast', 'cfg-smart', 'cfg-custom']);
    expect(s.value).toBe('cfg-smart');
    m.unmount();
  });

  it('shows a config the portal cannot run as disabled, with its reason', async () => {
    stub();
    const m = mountComponent(AgentChat, { agentId: 'a1', appId: 'app-1', aiChoices: CHOICES });
    await listLoaded();
    const custom = [...select()!.options].find((o) => o.value === 'cfg-custom')!;
    expect(custom.disabled).toBe(true);
    expect(custom.textContent).toContain("can't run in portal chats yet");
    m.unmount();
  });

  it('with no choice made, starts and sends no config name and no aiConfigChoice (the server resolves)', async () => {
    stub();
    const m = mountComponent(AgentChat, { agentId: 'a1', appId: 'app-1', aiChoices: CHOICES });
    await listLoaded();
    await newChat();
    for (const body of [last('/api/agent-chat/start')]) {
      expect('configName' in body).toBe(false);
      expect('aiConfigChoice' in body).toBe(false);
    }
    await send('hi');
    expect('configName' in last('/api/agent-chat/turn')).toBe(false);
    expect('aiConfigChoice' in last('/api/agent-chat/turn')).toBe(false);
    m.unmount();
  });

  it('a changed choice goes with the next turn by id only, never with a name (BLIND F1)', async () => {
    stub();
    const m = mountComponent(AgentChat, { agentId: 'a1', appId: 'app-1', aiChoices: CHOICES });
    await listLoaded();
    await newChat();
    const s = select()!;
    s.value = 'cfg-fast';
    s.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    await send('hi');
    expect(last('/api/agent-chat/turn')).toMatchObject({ aiConfigChoice: 'cfg-fast' });
    expect('configName' in last('/api/agent-chat/turn')).toBe(false);
    m.unmount();
  });

  // portal#1997: with no pick, the server runs the App chatbot config even when the portal can't run it, so
  // that config is what the dropdown shows, and Default stays pickable to choose the walk instead.
  const UNAVAILABLE_APP_CONFIG: ChatAiChoiceOption[] = [
    opt({ value: 'default', name: 'default', provider: null, model: null, isDefault: true }),
    opt({ value: 'cfg-fast', name: 'fast', model: 'haiku' }),
    opt({ value: 'cfg-appbot', name: 'appbot', model: 'k2', isAppChatbotConfig: true, unavailableReason: 'no key available here' }),
  ];

  it('a new chat shows the App chatbot config the turn will run, even when the portal cannot run it (#1997)', async () => {
    stub();
    const m = mountComponent(AgentChat, { agentId: 'a1', appId: 'app-1', aiChoices: UNAVAILABLE_APP_CONFIG });
    await listLoaded();
    try {
      const s = select()!;
      expect(s.value).toBe('cfg-appbot');
      const shown = s.options[s.selectedIndex];
      expect(shown.textContent).toContain('no key available here');
      // The shown option is itself unavailable (disabled), not only labelled so; Default stays pickable.
      expect(shown.disabled).toBe(true);
      expect([...s.options].find((o) => o.value === 'default')!.disabled).toBe(false);
    } finally {
      m.unmount();
    }
  });

  it('picking Default from that shown config sends aiConfigChoice default (#1997)', async () => {
    stub();
    const m = mountComponent(AgentChat, { agentId: 'a1', appId: 'app-1', aiChoices: UNAVAILABLE_APP_CONFIG });
    await listLoaded();
    try {
      await newChat();
      const s = select()!;
      // Precondition: the pick below is a change FROM the shown App config, not a no-op.
      expect(s.value).toBe('cfg-appbot');
      s.value = 'default';
      s.dispatchEvent(new Event('change', { bubbles: true }));
      await tick();
      await send('hi');
      expect(last('/api/agent-chat/turn')).toMatchObject({ aiConfigChoice: 'default' });
    } finally {
      m.unmount();
    }
  });

  it('a reopened chat shows the choice stored with it', async () => {
    stub('cfg-fast');
    const m = mountComponent(AgentChat, { agentId: 'a1', appId: 'app-1', aiChoices: CHOICES });
    await listLoaded();
    await until(() => [...document.querySelectorAll('button')].some((b) => /^\s*Old/.test(b.textContent ?? '')), 'the old chat to be listed');
    clickButton(/^\s*Old/);
    await until(() => calls('/api/agent-chat/resume') > 0, 'the old chat to resume');
    await until(() => select()?.value === 'cfg-fast', 'the stored choice to show');
    expect(select()!.value).toBe('cfg-fast');
    await send('hi');
    // The stored choice is the server's to apply: the turn names no config.
    expect('configName' in last('/api/agent-chat/turn')).toBe(false);
    expect('aiConfigChoice' in last('/api/agent-chat/turn')).toBe(false);
    m.unmount();
  });

  it('without choices (no App, or the list could not be read) there is no dropdown', async () => {
    stub();
    const m = mountComponent(AgentChat, { agentId: 'a1' });
    await listLoaded();
    expect(select()).toBeNull();
    m.unmount();
  });
});
