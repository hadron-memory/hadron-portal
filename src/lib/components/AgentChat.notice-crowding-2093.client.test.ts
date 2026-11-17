/** portal#2093: long conversation/stage names must not let the header notices grow past one line each. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, wait } from '$lib/test/mountComponent';
import AgentChat from './AgentChat.svelte';

const LONG = 'a-very-long-conversation-name-that-runs-well-past-fifty-seven-chars';
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
const CHAT = { id: 'i1', loc: 'chats:c1', title: 'First chat', conversationName: 'intro', stageName: 'stage-one', messageCount: 0, createdAt: '2026-01-01T00:00:00Z', lastMessageAt: null, scope: 'private', createdBy: null };
const TURN = { assistantMessage: 'ok', stageTransitioned: true, newStageName: LONG, conversationHandoff: null, chatEnded: false, onTrack: true, offTrackReason: null, conversationCompleted: LONG, detourReturned: true, rejectedNextStage: null, routingSkipped: false };
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('AgentChat notices with long names (#2093)', () => {
  it('each notice is a single truncated line that keeps its full text', async () => {
    vi.stubGlobal('fetch', vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes('/list')) return json({ chats: [CHAT] });
      if (u.includes('/start')) return json({ chatId: 'chats:c1', conversationName: 'intro', stageName: 'stage-one', welcomeMessage: null, welcomeError: null, scope: 'private' });
      if (u.includes('/turn')) return json(TURN);
      return json({});
    }));
    const m = mountComponent(AgentChat, { agentId: 'a' });
    await wait(20);
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('New chat'))!.click();
    await wait(30); await tick();
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    box.value = 'hi'; box.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    [...document.querySelectorAll('button')].find((b) => /send/i.test(b.textContent ?? ''))!.click();
    await wait(40); await tick();
    const notes = [...document.querySelectorAll('[data-testid="chat-progress-note"], [data-testid="stage-toast"]')];
    expect(notes.length).toBe(3);
    for (const n of notes) {
      expect(n.classList.contains('truncate')).toBe(true);
      expect(n.getAttribute('title')).toContain(LONG);
    }
    const chips = [...document.querySelectorAll('[data-testid="completed-conversations"] li')];
    expect(chips.length).toBeGreaterThan(0);
    for (const li of chips) { expect(li.classList.contains('truncate')).toBe(true); expect(li.getAttribute('title')).toBe(LONG); }
    m.unmount();
  });
});
