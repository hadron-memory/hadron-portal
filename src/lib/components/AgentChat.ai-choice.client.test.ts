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
      return json({ chats: [{ id: 'chats:old', title: 'Old', conversationName: null, stageName: null, messageCount: 1, scope: 'private', aiConfigChoice: stored }] });
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
  clickButton(/send/i);
  await wait(30);
  await tick();
}
const last = (path: string) => [...bodies].reverse().find((b) => b.url === path)!.body;

afterEach(() => { vi.unstubAllGlobals(); });

describe('AgentChat: the AI config dropdown (#1963)', () => {
  it('lists the choices and preselects the App chatbot config', async () => {
    stub();
    const m = mountComponent(AgentChat, { agentId: 'a1', appId: 'app-1', aiChoices: CHOICES });
    await wait(20);
    const s = select()!;
    expect([...s.options].map((o) => o.value)).toEqual(['default', 'cfg-fast', 'cfg-smart', 'cfg-custom']);
    expect(s.value).toBe('cfg-smart');
    m.unmount();
  });

  it('shows a config the portal cannot run as disabled, with its reason', async () => {
    stub();
    const m = mountComponent(AgentChat, { agentId: 'a1', appId: 'app-1', aiChoices: CHOICES });
    await wait(20);
    const custom = [...select()!.options].find((o) => o.value === 'cfg-custom')!;
    expect(custom.disabled).toBe(true);
    expect(custom.textContent).toContain("can't run in portal chats yet");
    m.unmount();
  });

  it('with no choice made, starts and sends with the preselected name and no aiConfigChoice', async () => {
    stub();
    const m = mountComponent(AgentChat, { agentId: 'a1', appId: 'app-1', aiChoices: CHOICES });
    await wait(20);
    clickButton(/New chat/);
    await wait(30);
    await tick();
    expect(last('/api/agent-chat/start')).toMatchObject({ configName: 'smart' });
    expect('aiConfigChoice' in last('/api/agent-chat/start')).toBe(false);
    await send('hi');
    expect(last('/api/agent-chat/turn')).toMatchObject({ configName: 'smart' });
    expect('aiConfigChoice' in last('/api/agent-chat/turn')).toBe(false);
    m.unmount();
  });

  it('a changed choice goes with the next turn, by id and by name', async () => {
    stub();
    const m = mountComponent(AgentChat, { agentId: 'a1', appId: 'app-1', aiChoices: CHOICES });
    await wait(20);
    clickButton(/New chat/);
    await wait(30);
    await tick();
    const s = select()!;
    s.value = 'cfg-fast';
    s.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    await send('hi');
    expect(last('/api/agent-chat/turn')).toMatchObject({ configName: 'fast', aiConfigChoice: 'cfg-fast' });
    m.unmount();
  });

  it('a reopened chat shows the choice stored with it', async () => {
    stub('cfg-fast');
    const m = mountComponent(AgentChat, { agentId: 'a1', appId: 'app-1', aiChoices: CHOICES });
    await wait(20);
    clickButton(/^\s*Old/);
    await wait(30);
    await tick();
    expect(select()!.value).toBe('cfg-fast');
    await send('hi');
    expect(last('/api/agent-chat/turn')).toMatchObject({ configName: 'fast' });
    m.unmount();
  });

  it('without choices (no App, or the list could not be read) there is no dropdown', async () => {
    stub();
    const m = mountComponent(AgentChat, { agentId: 'a1' });
    await wait(20);
    expect(select()).toBeNull();
    m.unmount();
  });
});
