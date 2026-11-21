/** portal#2093: long conversation/stage names must not let the header notices grow past one line each. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import AgentChat from './AgentChat.svelte';

const LONG = 'a-very-long-conversation-name-that-runs-well-past-fifty-seven-chars';
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
const CHAT = { id: 'i1', loc: 'chats:c1', title: 'First chat', conversationName: 'intro', stageName: 'stage-one', messageCount: 0, createdAt: '2026-01-01T00:00:00Z', lastMessageAt: null, scope: 'private', createdBy: null };
const TURN = { assistantMessage: 'ok', stageTransitioned: true, newStageName: LONG, conversationHandoff: null, chatEnded: false, onTrack: true, offTrackReason: null, conversationCompleted: LONG, detourReturned: true, rejectedNextStage: null, routingSkipped: false };
/**
 * The chat API as the component calls it. Each route is matched on its exact pathname (the query string is
 * the only thing allowed to vary), and anything else throws, so a renamed or extra request fails the test instead
 * of being answered by a substring match.
 */
const unexpected: string[] = [];
function stubChatApi(turn: unknown) {
  unexpected.length = 0;
  const routes: Record<string, unknown> = {
    '/api/agent-chat/list': { chats: [CHAT] },
    '/api/agent-chat/start': { chatId: 'chats:c1', conversationName: 'intro', stageName: 'stage-one', welcomeMessage: null, welcomeError: null, scope: 'private' },
    '/api/agent-chat/turn': turn,
    // The ServedPrompt child's read; an empty page is the honest answer for a viewer with nothing served here.
    '/api/served-prompts': { items: [], total: 0, offset: 0, limit: 5 },
  };
  vi.stubGlobal('fetch', vi.fn(async (i: RequestInfo | URL) => {
    const { pathname } = new URL(String(i), 'http://portal.test');
    // The component swallows a failed request, so a throw alone could go unseen: afterEach asserts this stayed empty.
    if (!Object.hasOwn(routes, pathname)) { unexpected.push(String(i)); throw new Error(`unexpected fetch: ${String(i)}`); }
    return json(routes[pathname]);
  }));
}
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; expect(unexpected).toEqual([]); });

describe('AgentChat notices with long names (#2093)', () => {
  it('each notice wraps to at most two lines and keeps its full text', async () => {
    stubChatApi(TURN);
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
      // Vertical padding on the clamped element lets a third line show through it; the padding belongs on the wrapper.
      expect(n.className).not.toMatch(/(^|\s)p[ytb]?-\d/);
      expect(n.getAttribute('title')).toBe(n.textContent?.trim());
    }
    // Exact, like the chips below: each notice's title is its whole text, not merely something containing the name.
    expect(notes.map((n) => n.getAttribute('title'))).toEqual([
      `Stage transitioned: stage-one → ${LONG}`,
      `Done: ${LONG}`,
      `Back to ${LONG}`,
    ]);
    const chips = [...document.querySelectorAll('[data-testid="completed-conversations"] li')];
    expect(chips.length).toBeGreaterThan(0);
    for (const li of chips) { expect(li.classList.contains('truncate')).toBe(true); expect(li.getAttribute('title')).toBe(LONG); }
    m.unmount();
  });
});

describe('stage toast bolds the two stage names (#2226)', () => {
  it('wraps from and to in <strong> while textContent still equals the title', async () => {
    stubChatApi(TURN);
    const m = mountComponent(AgentChat, { agentId: 'a' });
    const button = (re: RegExp) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));
    await vi.waitFor(() => expect(button(/new chat/i)).toBeDefined());
    button(/new chat/i)!.click();
    await vi.waitFor(() => expect(document.querySelector('textarea')).not.toBeNull());
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    box.value = 'hi'; box.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    await vi.waitFor(() => expect(button(/send/i)).toBeDefined());
    button(/send/i)!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="stage-toast"]')).not.toBeNull());
    const toast = document.querySelector('[data-testid="stage-toast"]') as HTMLElement;
    // The pre-#2208 emphasis: exactly the from and to names carry it, nothing else.
    const strongs = [...toast.querySelectorAll('strong')];
    expect(strongs.map((s) => s.textContent)).toEqual(['stage-one', LONG]);
    // <strong> adds no text: the clamp/equality invariant of #2093 is untouched.
    expect(toast.getAttribute('title')).toBe(toast.textContent?.trim());
    expect(toast.getAttribute('title')).toContain(LONG);
    m.unmount();
  });
});

describe('refused-stage note copy (#2184)', () => {
  it('leads with what stays true (same step, message saved) and puts the name last', async () => {
    const REFUSED = { ...TURN, stageTransitioned: false, newStageName: null, conversationCompleted: null, detourReturned: false, rejectedNextStage: LONG };
    stubChatApi(REFUSED);
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
