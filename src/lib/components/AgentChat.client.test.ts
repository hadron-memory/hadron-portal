import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureUnhandledRejections, mountComponent, tick, wait } from '$lib/test/mountComponent';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import AgentChat from './AgentChat.svelte';

/**
 * #789/#794's teardown guard, tested against the REAL component (#795).
 *
 * This is the test that could not be written before. The fix shipped with
 * "verified **not at all** locally" on its own PR: the component is gated
 * behind an LLM provider config, so it never mounts in a dev environment
 * either, and the SSR harness never runs `onMount` at all. The structural
 * invariant ("there is exactly one `replaceState` call, and it is inside the
 * guarded helper") was pinned instead, because nothing could reach the
 * behaviour.
 *
 * The path exercised is the `onMount` else-branch: a stale `?chat=<id>` that
 * the fetched list does not contain, which clears the param via
 * `syncChatIdToUrl(null)` — AFTER `await refreshChatList()`. That await is the
 * teardown window, and `syncChatIdToUrl` reads `window.location.href` LIVE, so
 * an unguarded continuation rewrites whatever page the user is on now.
 */
describe('AgentChat: syncChatIdToUrl after teardown (#789)', () => {
  const AGENT_ID = 'agent-under-test';

  beforeEach(() => {
    resetNavigationCalls();
    // A stale ?chat= is what sends onMount down the branch that navigates.
    window.history.replaceState({}, '', '/app/agents/agent-under-test?chat=chats%3Agone');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * The list fetch is held open deliberately. Resolving it immediately would
   * let the continuation finish before `unmount()`, and the test would pass
   * without ever entering the teardown window — green for the wrong reason.
   */
  function stubFetch(delayMs: number) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/agent-chat/list')) {
          await wait(delayMs);
          // Successful but EMPTY: `listError === null` plus no match is exactly
          // the else-branch's condition.
          return new Response(JSON.stringify({ chats: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
  }

  it('does NOT rewrite the URL when the component is destroyed mid-flight', async () => {
    stubFetch(20);
    const m = mountComponent(AgentChat, { agentId: AGENT_ID });

    // The user navigates away before the list comes back.
    m.unmount();

    // Let the held fetch resolve and its continuation run to completion.
    await wait(60);
    await tick();

    expect(navigationCalls).toEqual([]);
  });

  /**
   * The other half. Without this, the test above would also pass on a component
   * whose `onMount` never reached the navigation at all — which is the same
   * false green the SSR harness gave us for two years.
   */
  it('DOES rewrite it while still mounted, so the guard is not just suppressing the feature', async () => {
    stubFetch(0);
    const m = mountComponent(AgentChat, { agentId: AGENT_ID });

    await wait(30);
    await tick();

    expect(navigationCalls.map((c) => c.fn)).toEqual(['replaceState']);
    // The stale ?chat= is what gets cleared.
    expect(String(navigationCalls[0].args[0])).not.toContain('chat=');

    m.unmount();
  });
});

/**
 * portal#1611 (A6/A6b): the chat reports its model on every start and send, and
 * the server may refuse the value (BAD_USER_INPUT). The portal's answer is ONE
 * fixed message and no replay — in particular never a second call without the
 * model. The endpoints already turn a refusal into the fixed text (pinned in
 * llm-model-1611.test.ts); this is the rendered half: what the user sees, and
 * that the component itself does not retry.
 */
describe('AgentChat: a refused start or send is shown once and never replayed (#1611)', () => {
  const FIXED = 'Chat request failed. Please try again.';
  const calls: string[] = [];

  function stub(o: { start?: 'refuse'; turn?: 'refuse' }) {
    calls.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url.replace(/\?.*/, ''));
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/api/agent-chat/list')) return json({ chats: [] });
      if (url.includes('/api/agent-chat/start')) {
        return o.start === 'refuse'
          ? json({ error: FIXED }, 500)
          : json({ chatId: 'chats:c1', conversationName: 'c', stageName: 's', welcomeMessage: null, welcomeError: null, scope: 'private' });
      }
      if (url.includes('/api/agent-chat/turn')) return o.turn === 'refuse' ? json({ error: FIXED, code: 'failed' }, 500) : json({ assistantMessage: 'ok' });
      return json({});
    }));
  }
  const count = (path: string) => calls.filter((c) => c === path).length;
  const text = () => document.body.textContent ?? '';
  const occurrences = (s: string) => text().split(s).length - 1;

  afterEach(() => { vi.unstubAllGlobals(); });

  it('a refused start shows the fixed message once and calls /start once', async () => {
    stub({ start: 'refuse' });
    const m = mountComponent(AgentChat, { agentId: 'agent-under-test' });
    await wait(20);
    const startButton = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('New chat'))!;
    startButton.click();
    await wait(30);
    await tick();
    expect(occurrences(FIXED)).toBe(1);
    expect(count('/api/agent-chat/start')).toBe(1);
    expect(count('/api/agent-chat/turn')).toBe(0);
    m.unmount();
  });

  it('a refused send shows the fixed message once, keeps the draft, and calls /turn once', async () => {
    stub({ turn: 'refuse' });
    const m = mountComponent(AgentChat, { agentId: 'agent-under-test' });
    await wait(20);
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('New chat'))!.click();
    await wait(30);
    await tick();
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    box.value = 'hello there';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    [...document.querySelectorAll('button')].find((b) => /send/i.test(b.textContent ?? ''))!.click();
    await wait(30);
    await tick();
    expect(occurrences(FIXED)).toBe(1);
    expect(count('/api/agent-chat/turn')).toBe(1);
    expect(count('/api/agent-chat/start')).toBe(1);
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('hello there');
    m.unmount();
  });
});

/**
 * portal#916: a chat turn whose extraction the authoring gate refused AFTER the server saved the reply
 * (hadron-server#3514). The turn route answers 409 with a fixed message and `partialTurn: true`; the component
 * must not roll the user bubble back or refill the sent text (a resend would duplicate the turn), must reload
 * the conversation, must say so truthfully when the reload fails, must keep a newer draft, and must touch only the
 * chat the turn belonged to. The same failure WITHOUT the flag keeps today's rollback.
 */
describe('AgentChat: a partial turn is reloaded, never rolled back or refilled (#916)', () => {
  const NOTICE = "Your message was sent and the reply was saved, but the chat couldn't save the information it collected: this memory accepts that data only from a task-assigned author, and a chat turn doesn't name one. Ask whoever manages the memory. You don't need to send it again.";
  const GENERIC = 'Chat request failed. Please try again.';
  const REFRESH_FAILED = "The conversation couldn't be refreshed, so the saved messages may not be shown here. Reload the page to see them.";
  let resumeBodies: Array<{ chatId: string }>;
  let turnCalls: number;

  type Script = {
    turn?: () => Promise<Response> | Response;
    resume?: (chatId: string) => Response | Promise<Response>;
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const CHATS = [
    { id: 'i1', loc: 'chats:c1', title: 'First chat', conversationName: null, stageName: 'stage-one', messageCount: 0, createdAt: '2026-01-01T00:00:00Z', lastMessageAt: null, scope: 'private', createdBy: null },
    { id: 'i2', loc: 'chats:c2', title: 'Second chat', conversationName: null, stageName: 'stage-one', messageCount: 0, createdAt: '2026-01-01T00:00:00Z', lastMessageAt: null, scope: 'private', createdBy: null },
  ];
  const SAVED = [
    { role: 'user', content: 'hello there', seq: 1, createdAt: '2026-01-01T00:00:01Z' },
    { role: 'assistant', content: 'the saved reply', seq: 2, createdAt: '2026-01-01T00:00:02Z' },
  ];
  const partial = () => json({ error: NOTICE, code: 'partialTurnAttestationMissing', partialTurn: true }, 409);

  function stub(script: Script) {
    resumeBodies = [];
    turnCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/agent-chat/list')) return json({ chats: CHATS });
      if (url.includes('/api/agent-chat/start')) return json({ chatId: 'chats:c1', conversationName: 'c', stageName: 'stage-one', welcomeMessage: null, welcomeError: null, scope: 'private' });
      if (url.includes('/api/agent-chat/turn')) { turnCalls += 1; return script.turn ? script.turn() : json({ assistantMessage: 'ok' }); }
      if (url.includes('/api/agent-chat/resume')) {
        const b = JSON.parse(String(init?.body ?? '{}')) as { chatId: string };
        resumeBodies.push(b);
        if (script.resume) return script.resume(b.chatId);
        return json({ chat: { title: 'First chat', conversationName: null, stageName: 'stage-one', scope: 'private' }, messages: SAVED, hasOlder: false });
      }
      return json({});
    }));
  }
  const text = () => document.body.textContent ?? '';
  const occurrences = (s: string) => text().split(s).length - 1;
  const box = () => document.querySelector('textarea') as HTMLTextAreaElement;
  async function startChat() {
    const m = mountComponent(AgentChat, { agentId: 'agent-under-test' });
    await wait(20);
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('New chat'))!.click();
    await wait(30);
    await tick();
    return m;
  }
  function type(value: string) {
    box().value = value;
    box().dispatchEvent(new Event('input', { bubbles: true }));
  }
  async function send(value: string) {
    type(value);
    await tick();
    [...document.querySelectorAll('button')].find((b) => /send/i.test(b.textContent ?? ''))!.click();
  }
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reloads the conversation, shows the fixed notice once, does not refill the sent text and shows no stage toast', async () => {
    stub({ turn: partial });
    const m = await startChat();
    const resumesBefore = resumeBodies.length;
    await send('hello there');
    await wait(40);
    await tick();
    expect(turnCalls).toBe(1);
    expect(resumeBodies.slice(resumesBefore)).toEqual([{ agentId: 'agent-under-test', chatId: 'chats:c1' }]);
    expect(occurrences(NOTICE)).toBe(1);
    expect(box().value).toBe('');
    // the reloaded server transcript is what is shown, and the sent message is not duplicated by a rollback or a refill
    expect(occurrences('the saved reply')).toBe(1);
    expect(occurrences('hello there')).toBe(1);
    expect(text()).not.toContain('Stage transitioned');
    expect(text()).not.toContain(GENERIC);
    m.unmount();
  });

  it('a failed reload says the reply was saved and the refresh failed, never that the messages are shown, and still does not refill', async () => {
    let first = true;
    stub({
      turn: partial,
      resume: () => {
        // the reload after the turn is the only resume in this test
        first = false;
        return json({ error: 'boom' }, 500);
      },
    });
    const m = await startChat();
    await send('hello there');
    await wait(40);
    await tick();
    expect(first).toBe(false);
    expect(occurrences(NOTICE)).toBe(1);
    expect(occurrences(REFRESH_FAILED)).toBe(1);
    expect(text()).not.toContain('boom');
    expect(box().value).toBe('');
    m.unmount();
  });

  it('keeps a draft typed while the turn was pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    stub({ turn: async () => { await gate; return partial(); } });
    const m = await startChat();
    await send('hello there');
    await tick();
    type('a newer draft');
    await tick();
    release();
    await wait(40);
    await tick();
    expect(box().value).toBe('a newer draft');
    expect(occurrences(NOTICE)).toBe(1);
    m.unmount();
  });

  it('after a chat switch the other chat gets no reload and no notice', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    stub({
      turn: async () => { await gate; return partial(); },
      resume: (chatId) => json({ chat: { title: chatId, conversationName: null, stageName: 'stage-one', scope: 'private' }, messages: [{ role: 'assistant', content: `history of ${chatId}`, seq: 1, createdAt: '2026-01-01T00:00:01Z' }], hasOlder: false }),
    });
    const m = await startChat();
    await send('hello there');
    await tick();
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Second chat'))!.click();
    await wait(30);
    const resumesAfterSwitch = resumeBodies.length;
    release();
    await wait(40);
    await tick();
    expect(resumeBodies).toHaveLength(resumesAfterSwitch);
    expect(resumeBodies.at(-1)).toEqual({ agentId: 'agent-under-test', chatId: 'chats:c2' });
    expect(text()).not.toContain(NOTICE);
    expect(text()).toContain('history of chats:c2');
    m.unmount();
  });

  it('a reload that lands after the user left and reopened the chat is dropped: the fresh transcript stays, no stale notice', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let n = 0;
    stub({
      turn: partial,
      resume: async (chatId) => {
        n += 1;
        const reload = n === 1; // the reload the partial turn starts, held open
        if (reload) await gate;
        return json({ chat: { title: chatId, conversationName: null, stageName: 'stage-one', scope: 'private' }, messages: [{ role: 'assistant', content: reload ? 'stale reload' : `fresh ${chatId}`, seq: 1, createdAt: '2026-01-01T00:00:01Z' }], hasOlder: false });
      },
    });
    const m = await startChat();
    await send('hello there');
    await wait(30);
    const click = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!.click();
    click('Second chat');
    await wait(30);
    click('First chat');
    await wait(30);
    expect(text()).toContain('fresh chats:c1');
    release();
    await wait(40);
    await tick();
    expect(text()).toContain('fresh chats:c1');
    expect(text()).not.toContain('stale reload');
    expect(text()).not.toContain(NOTICE);
    m.unmount();
  });

  it('a turn issued in a window the user has since left and reopened does NOT start another reload (#1727 LOCAL P2-1)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    stub({
      turn: async () => { await gate; return partial(); },
      resume: (chatId) => json({ chat: { title: chatId, conversationName: null, stageName: 'stage-one', scope: 'private' }, messages: [{ role: 'assistant', content: `history of ${chatId}`, seq: 1, createdAt: '2026-01-01T00:00:01Z' }], hasOlder: false }),
    });
    const m = await startChat();
    await send('hello there');
    await tick();
    const click = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!.click();
    click('Second chat');
    await wait(30);
    click('First chat');
    await wait(30);
    const resumesBefore = resumeBodies.length;
    release();
    await wait(40);
    await tick();
    // the old turn belongs to the old window: no third resume, no notice in the reopened window
    expect(resumeBodies).toHaveLength(resumesBefore);
    expect(text()).not.toContain(NOTICE);
    m.unmount();
  });

  it('a fresh partial turn issued after reopening the chat still reloads and shows its notice (control for P2-1)', async () => {
    stub({ turn: partial });
    const m = await startChat();
    const click = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!.click();
    click('Second chat');
    await wait(30);
    click('First chat');
    await wait(30);
    const resumesBefore = resumeBodies.length;
    await send('hello again');
    await wait(40);
    await tick();
    expect(resumeBodies).toHaveLength(resumesBefore + 1);
    expect(occurrences(NOTICE)).toBe(1);
    m.unmount();
  });

  it('the status region is mounted before any notice exists, so the later text is announced (#1727 LOCAL P2-2)', async () => {
    stub({ turn: partial });
    const m = await startChat();
    const region = document.querySelector('[role="status"][data-testid="partial-turn-notice"]');
    expect(region).not.toBeNull();
    expect(region!.textContent?.trim()).toBe('');
    await send('hello there');
    await wait(40);
    await tick();
    // the SAME node now carries the notice: it was updated, not mounted populated
    expect(document.querySelector('[role="status"][data-testid="partial-turn-notice"]')).toBe(region);
    expect(region!.textContent).toContain(NOTICE);
    m.unmount();
  });

  it('a 409 WITHOUT the partialTurn flag (a boot-prompt refusal) keeps today\'s rollback and refill (#1727 §10 P3-1)', async () => {
    stub({ turn: () => json({ error: 'No approved version of this Agent\'s boot prompt is available here.', code: 'bootPromptNotApproved' }, 409) });
    const m = await startChat();
    const resumesBefore = resumeBodies.length;
    await send('hello there');
    await wait(40);
    await tick();
    expect(box().value).toBe('hello there');
    expect(resumeBodies).toHaveLength(resumesBefore);
    expect(text()).not.toContain(NOTICE);
    m.unmount();
  });

  it('a failed reload that lands after a chat switch shows no notice in the other chat (#1727 §10 P3-2)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let n = 0;
    stub({
      turn: partial,
      resume: async (chatId) => {
        n += 1;
        if (n === 1) { await gate; return json({ error: 'boom' }, 500); }
        return json({ chat: { title: chatId, conversationName: null, stageName: 'stage-one', scope: 'private' }, messages: [{ role: 'assistant', content: `history of ${chatId}`, seq: 1, createdAt: '2026-01-01T00:00:01Z' }], hasOlder: false });
      },
    });
    const m = await startChat();
    await send('hello there');
    await wait(30);
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Second chat'))!.click();
    await wait(30);
    release();
    await wait(40);
    await tick();
    expect(text()).not.toContain(NOTICE);
    expect(text()).not.toContain(REFRESH_FAILED);
    expect(text()).toContain('history of chats:c2');
    m.unmount();
  });

  it('after unmount a held partial turn starts no reload and throws nothing; a live twin does reload (#1727 LOCAL P3-1)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    stub({ turn: async () => { await gate; return partial(); } });
    const live = await startChat();
    await send('hello there');
    await tick();
    const before = resumeBodies.length;
    const rejections = await captureUnhandledRejections(async () => {
      live.unmount();
      release();
      await wait(50);
    });
    expect(rejections).toEqual([]);
    expect(resumeBodies).toHaveLength(before);
    // twin: same flow without unmounting does reload, so the assertion above is not a harness that never ran
    let release2!: () => void;
    const gate2 = new Promise<void>((r) => { release2 = r; });
    stub({ turn: async () => { await gate2; return partial(); } });
    const twin = await startChat();
    await send('hello there');
    await tick();
    const before2 = resumeBodies.length;
    release2();
    await wait(50);
    expect(resumeBodies).toHaveLength(before2 + 1);
    twin.unmount();
  });

  it('the same failure WITHOUT the flag keeps today\'s rollback: bubble dropped, text refilled, no reload', async () => {
    stub({ turn: () => json({ error: GENERIC, code: 'failed' }, 500) });
    const m = await startChat();
    const resumesBefore = resumeBodies.length;
    await send('hello there');
    await wait(40);
    await tick();
    expect(occurrences(GENERIC)).toBe(1);
    expect(box().value).toBe('hello there');
    expect(resumeBodies).toHaveLength(resumesBefore);
    m.unmount();
  });
});
