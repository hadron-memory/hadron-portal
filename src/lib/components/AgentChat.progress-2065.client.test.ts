/**
 * portal#2065 (S8): the chat header says when a conversation finished, when a detour returned and when a stage
 * was refused, and a resumed chat shows its done list from Chat.completedConversations (spec
 * hrn:node:hadronmemory.com:specs:cor:cht:030:02). Display only: no controls, no server text.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, wait } from '$lib/test/mountComponent';
import AgentChat from './AgentChat.svelte';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const CHAT = { id: 'i1', loc: 'chats:c1', title: 'First chat', conversationName: 'intro', stageName: 'stage-one', messageCount: 0, createdAt: '2026-01-01T00:00:00Z', lastMessageAt: null, scope: 'private', createdBy: null };
const TURN = { assistantMessage: 'ok', stageTransitioned: false, newStageName: null, conversationHandoff: null, chatEnded: false, onTrack: true, offTrackReason: null, conversationCompleted: null, detourReturned: false, rejectedNextStage: null, routingSkipped: false };

function stub(turn: Record<string, unknown>, resumeChat: Record<string, unknown> = {}, listChat: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/agent-chat/list')) return json({ chats: [{ ...CHAT, ...listChat }] });
    if (url.includes('/api/agent-chat/start')) return json({ chatId: 'chats:c1', conversationName: 'intro', stageName: 'stage-one', welcomeMessage: null, welcomeError: null, scope: 'private' });
    if (url.includes('/api/agent-chat/turn')) return json({ ...TURN, ...turn });
    if (url.includes('/api/agent-chat/resume')) return json({ chat: { ...CHAT, ...resumeChat }, messages: [], hasOlder: false });
    return json({});
  }));
}
const text = () => document.body.textContent ?? '';
const box = () => document.querySelector('textarea') as HTMLTextAreaElement;
const notice = () => document.querySelector('[role="status"][data-testid="chat-progress-notice"]');
async function startAndSend() {
  const m = mountComponent(AgentChat, { agentId: 'agent-under-test' });
  await wait(20);
  [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'New chat')!.click();
  await wait(30);
  await tick();
  box().value = 'hello';
  box().dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
  [...document.querySelectorAll('button')].find((b) => /send/i.test(b.textContent ?? ''))!.click();
  await wait(40);
  await tick();
  return m;
}
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('AgentChat: completion, detour return and rejected stage (#2065)', () => {
  it('the status region is mounted before any cue exists, so a later cue is announced', async () => {
    stub({});
    const m = mountComponent(AgentChat, { agentId: 'agent-under-test' });
    await wait(20);
    [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'New chat')!.click();
    await wait(30);
    await tick();
    expect(notice()).not.toBeNull();
    expect(notice()!.textContent?.trim()).toBe('');
    m.unmount();
  });

  it('a completed conversation says so, by name, and joins the header done list', async () => {
    stub({ conversationCompleted: 'intro' });
    const m = await startAndSend();
    expect(notice()!.textContent).toContain('intro');
    expect(notice()!.textContent).toBe('Done: intro');
    expect(document.querySelector('[data-testid="completed-conversations"]')?.textContent).toContain('intro');
    m.unmount();
  });

  it('a detour return names where the chat came back to', async () => {
    stub({ detourReturned: true, stageTransitioned: true, conversationHandoff: 'main', newStageName: 'back-here' });
    const m = await startAndSend();
    // the stage name alone: a conversation/stage path is a setup term (UX)
    expect(notice()!.textContent).toBe('Back to back-here');
    m.unmount();
  });

  it('a rejected stage is a quiet note naming it, and the chat stays where it was', async () => {
    stub({ rejectedNextStage: 'nowhere' });
    const m = await startAndSend();
    expect(notice()!.textContent).toContain('"nowhere"');
    // a refused stage must not wear the success tone (UX P2)
    expect(notice()!.querySelector('p')!.className).not.toContain('emerald');
    expect(text()).toContain('stage-one');
    expect(text()).not.toContain('Stage transitioned');
    m.unmount();
  });

  it('an ordinary turn shows no cue', async () => {
    stub({});
    const m = await startAndSend();
    expect(notice()!.textContent?.trim()).toBe('');
    expect(document.querySelector('[data-testid="completed-conversations"]')).toBeNull();
    m.unmount();
  });

  it('a repeated completion is not added to the done list twice', async () => {
    stub({ conversationCompleted: 'intro' });
    const m = await startAndSend();
    await tick();
    box().value = 'again';
    box().dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    [...document.querySelectorAll('button')].find((b) => /send/i.test(b.textContent ?? ''))!.click();
    await wait(40);
    await tick();
    const items = document.querySelectorAll('[data-testid="completed-conversations"] li');
    expect(items).toHaveLength(1);
    m.unmount();
  });
});

describe('AgentChat: the welcome turn is part of start (#2065, LOCAL F1/F2)', () => {
  const SAVED = [{ role: 'assistant', content: 'the saved welcome', seq: 1, createdAt: '2026-01-01T00:00:01Z' }];
  async function startOnly(start: Record<string, unknown>) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/agent-chat/list')) return json({ chats: [{ ...CHAT }] });
      if (url.includes('/api/agent-chat/start')) return json({ chatId: 'chats:c1', conversationName: 'intro', stageName: 'stage-one', welcomeMessage: null, welcomeError: null, scope: 'private', ...start });
      if (url.includes('/api/agent-chat/resume')) return json({ chat: { ...CHAT }, messages: SAVED, hasOlder: false });
      return json({});
    }));
    const m = mountComponent(AgentChat, { agentId: 'agent-under-test' });
    await wait(20);
    [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'New chat')!.click();
    await wait(60);
    await tick();
    return m;
  }
  it('a completion on the welcome turn fills the Done list and the notice', async () => {
    const m = await startOnly({ welcomeMessage: 'hi', conversationCompleted: 'intro' });
    expect(document.querySelector('[data-testid="completed-conversations"]')?.textContent).toContain('intro');
    expect(notice()!.textContent).toBe('Done: intro');
    m.unmount();
  });
  it('a refused stage on the welcome turn shows its quiet note', async () => {
    const m = await startOnly({ welcomeMessage: 'hi', rejectedNextStage: 'nowhere' });
    expect(notice()!.textContent).toContain('"nowhere"');
    m.unmount();
  });
  it('an EDGE partial on the welcome turn reloads the saved reply and says so, never the generic hint', async () => {
    const m = await startOnly({ welcomePartial: true, welcomeError: 'Saved reply copy.' });
    expect(text()).toContain('the saved welcome');
    expect(text()).toContain('Saved reply copy.');
    expect(text()).not.toContain("Couldn't generate a welcome message");
    m.unmount();
  });
});

describe('AgentChat: resume shows the done list (#2065)', () => {
  async function resume() {
    const m = mountComponent(AgentChat, { agentId: 'agent-under-test' });
    await wait(20);
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('First chat'))!.click();
    await wait(40);
    await tick();
    return m;
  }
  it('lists the names from Chat.completedConversations in order', async () => {
    stub({}, { completedConversations: ['alpha', 'beta'] }, { completedConversations: ['alpha', 'beta'] });
    const m = await resume();
    const items = [...document.querySelectorAll('[data-testid="completed-conversations"] li')].map((li) => li.textContent?.trim());
    expect(items).toEqual(['alpha', 'beta']);
    m.unmount();
  });
  it('an empty list shows no chip and no heading', async () => {
    stub({}, { completedConversations: [] }, { completedConversations: [] });
    const m = await resume();
    expect(document.querySelector('[data-testid="completed-conversations"]')).toBeNull();
    m.unmount();
  });
});
