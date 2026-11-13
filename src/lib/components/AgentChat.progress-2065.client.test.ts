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
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('New chat'))!.click();
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
afterEach(() => { vi.unstubAllGlobals(); });

describe('AgentChat: completion, detour return and rejected stage (#2065)', () => {
  it('the status region is mounted before any cue exists, so a later cue is announced', async () => {
    stub({});
    const m = mountComponent(AgentChat, { agentId: 'agent-under-test' });
    await wait(20);
    expect(notice()).not.toBeNull();
    expect(notice()!.textContent?.trim()).toBe('');
    m.unmount();
  });

  it('a completed conversation says so, by name, and joins the header done list', async () => {
    stub({ conversationCompleted: 'intro' });
    const m = await startAndSend();
    expect(notice()!.textContent).toContain('intro');
    expect(notice()!.textContent).toMatch(/complete/i);
    expect(document.querySelector('[data-testid="completed-conversations"]')?.textContent).toContain('intro');
    m.unmount();
  });

  it('a detour return names where the chat came back to', async () => {
    stub({ detourReturned: true, stageTransitioned: true, conversationHandoff: 'main', newStageName: 'back-here' });
    const m = await startAndSend();
    expect(notice()!.textContent).toMatch(/returned/i);
    expect(notice()!.textContent).toContain('main');
    expect(notice()!.textContent).toContain('back-here');
    m.unmount();
  });

  it('a rejected stage is a quiet note naming it, and the chat stays where it was', async () => {
    stub({ rejectedNextStage: 'nowhere' });
    const m = await startAndSend();
    expect(notice()!.textContent).toContain('nowhere');
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

  it('a completion already on the done list is not added twice', async () => {
    stub({ conversationCompleted: 'intro' }, {}, { completedConversations: ['intro'] });
    const m = await startAndSend();
    const items = document.querySelectorAll('[data-testid="completed-conversations"] li');
    expect(items).toHaveLength(1);
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
