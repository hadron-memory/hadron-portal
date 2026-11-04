import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, wait } from '$lib/test/mountComponent';
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
