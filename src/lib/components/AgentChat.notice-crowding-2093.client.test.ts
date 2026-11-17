/** portal#2093: long conversation/stage names must not let the header notices grow past one line each. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import AgentChat from './AgentChat.svelte';

const LONG = 'a-very-long-conversation-name-that-runs-well-past-fifty-seven-chars';
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
const CHAT = { id: 'i1', loc: 'chats:c1', title: 'First chat', conversationName: 'intro', stageName: 'stage-one', messageCount: 0, createdAt: '2026-01-01T00:00:00Z', lastMessageAt: null, scope: 'private', createdBy: null };
const TURN = { assistantMessage: 'ok', stageTransitioned: true, newStageName: LONG, conversationHandoff: null, chatEnded: false, onTrack: true, offTrackReason: null, conversationCompleted: LONG, detourReturned: true, rejectedNextStage: null, routingSkipped: false };
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('AgentChat notices with long names (#2093)', () => {
  it('each notice wraps to at most two lines and keeps its full text', async () => {
    vi.stubGlobal('fetch', vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes('/list')) return json({ chats: [CHAT] });
      if (u.includes('/start')) return json({ chatId: 'chats:c1', conversationName: 'intro', stageName: 'stage-one', welcomeMessage: null, welcomeError: null, scope: 'private' });
      if (u.includes('/turn')) return json(TURN);
      throw new Error(`unexpected fetch: ${u}`);
    }));
    const m = mountComponent(AgentChat, { agentId: 'a' });
    const button = (re: RegExp) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));
    await vi.waitFor(() => expect(button(/new chat/i)).toBeDefined());
    button(/new chat/i)!.click();
    await vi.waitFor(() => expect(document.querySelector('textarea')).not.toBeNull());
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    box.value = 'hi'; box.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    await vi.waitFor(() => expect(button(/send/i)).toBeDefined());
    button(/send/i)!.click();
    await vi.waitFor(() => expect(document.querySelectorAll('[data-testid="chat-progress-item"]').length).toBe(2));
    const notes = [...document.querySelectorAll('[data-testid="chat-progress-item"], [data-testid="stage-toast"]')];
    expect(notes.length).toBe(3);
    for (const n of notes) {
      // At most two lines (the differing tail wraps into view), never one hidden-tail line; `title` keeps the full text.
      expect(n.classList.contains('line-clamp-2')).toBe(true);
      expect(n.classList.contains('truncate')).toBe(false);
      expect(n.getAttribute('title')).toBe(n.textContent?.trim());
      expect(n.getAttribute('title')).toContain(LONG);
    }
    const chips = [...document.querySelectorAll('[data-testid="completed-conversations"] li')];
    expect(chips.length).toBeGreaterThan(0);
    for (const li of chips) { expect(li.classList.contains('truncate')).toBe(true); expect(li.getAttribute('title')).toBe(LONG); }
    m.unmount();
  });
});

describe('refused-stage note copy (#2184)', () => {
  it('leads with what stays true (same step, message saved) and puts the name last', async () => {
    const REFUSED = { ...TURN, stageTransitioned: false, newStageName: null, conversationCompleted: null, detourReturned: false, rejectedNextStage: LONG };
    vi.stubGlobal('fetch', vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes('/list')) return json({ chats: [CHAT] });
      if (u.includes('/start')) return json({ chatId: 'chats:c1', conversationName: 'intro', stageName: 'stage-one', welcomeMessage: null, welcomeError: null, scope: 'private' });
      if (u.includes('/turn')) return json(REFUSED);
      throw new Error(`unexpected fetch: ${u}`);
    }));
    const m = mountComponent(AgentChat, { agentId: 'a' });
    const button = (re: RegExp) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));
    await vi.waitFor(() => expect(button(/new chat/i)).toBeDefined());
    button(/new chat/i)!.click();
    await vi.waitFor(() => expect(document.querySelector('textarea')).not.toBeNull());
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    box.value = 'hi'; box.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    await vi.waitFor(() => expect(button(/send/i)).toBeDefined());
    button(/send/i)!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="chat-progress-item"]')).not.toBeNull());
    expect(document.querySelector('[data-testid="chat-progress-item"]')!.textContent).toBe(`Staying on this step, and your message is saved. Couldn't move to "${LONG}".`);
    m.unmount();
  });
});
