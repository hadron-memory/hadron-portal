/**
 * #1916 — your own post shows in the chat at once, even over a restored view.
 *
 * The thread keeps a cached transcript per chat (`viewState`) so leaving the
 * Chats tab and coming back keeps your place. When that cached window is OLDER
 * than the fresh tail by more than a page, `resumeTranscript` keeps the cached
 * window and lets the forward poll fill the gap at 20 messages a tick, rather
 * than joining two windows with a hole between them.
 *
 * That is right for a reader, and wrong for a poster: the post's `invalidateAll`
 * brings a tail that holds the message they just sent, the gap rule keeps the
 * stale window, and the message stays off screen until the poll catches up —
 * minutes on a busy team chat, or a page refresh (which drops the cache).
 *
 * CLIENT lane: the post goes through superforms' own result handler, and the
 * fresh page data arrives inside `invalidateAll`, as kit delivers it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
import type { TeamChatMessage } from '$lib/types';
import TeamChatThread from './TeamChatThread.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
});

const message = (seq: number, over: Partial<TeamChatMessage> = {}): TeamChatMessage => ({
  nodeId: `m${seq}`,
  seq,
  body: `body ${seq}`,
  at: '2026-11-10T12:00:00.000Z',
  authorUserId: null,
  authorWorkerId: 'w1',
  authorName: 'Ada',
  sessionId: null,
  replyToSeq: null,
  mentions: [],
  urn: null,
  teamTags: null,
  ...over,
});
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => message(from + i));
const MINE = 'my own post';
const mine = (seq: number) => message(seq, { body: MINE, authorUserId: 'u1', authorWorkerId: null, authorName: 'holger' });

type Msg = { type: 'success' | 'error'; text: string };
async function posted(body: string, msg: Msg) {
  const f = await superValidate({ _kind: 'postTeamChatMessage', body }, zod4(postTeamChatMessageSchema));
  return { ...f, valid: true, message: msg };
}

/** A thread restored from a cached view that ends at seq 2, over a fresh tail 50–69. */
async function mountRestored(extra: Record<string, unknown> = {}) {
  setStubPage('https://example.test/app/apps/a1', { appId: 'a1' });
  const props = reactiveProps<Record<string, unknown>>({
    messages: range(50, 69),
    total: 69,
    postForm: await superValidate(zod4(postTeamChatMessageSchema), { errors: false }),
    workerUrns: null,
    pollMs: 0, // no poll: nothing but the post may bring the message in
    onViewStateChange: vi.fn(),
    viewState: { items: range(1, 2), total: 2, pendingNewer: 0, olderRemaining: 0, olderExhausted: true, scrollTop: 0, atBottom: true },
    ...extra,
  });
  const m = mountComponent(TeamChatThread as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return { m, props };
}
const formOf = (m: Mounted<Record<string, unknown>>) => m.target.querySelector<HTMLTextAreaElement>('#team-chat-body')!.closest('form')!;

describe('TeamChatThread — your own post (#1916)', () => {
  it('shows the message you just sent when the post\'s fresh tail is disjoint from the restored view', async () => {
    const { m, props } = await mountRestored();
    // Positive control: the restored (stale) window is what is on screen.
    expect(m.target.textContent).toContain('body 2');
    expect(m.target.textContent).not.toContain('body 69');

    navigationHooks.onInvalidateAll = () => {
      props.messages = [...range(52, 70), mine(71)];
      props.total = 71;
    };
    const ok = await posted(MINE, { type: 'success', text: 'Posted to the team chat.' });
    const { cancelled } = await submitEnhancedWithResult(formOf(m), { type: 'success', status: 200, data: { form: ok } });
    expect(cancelled).toBe(false);
    await tick(4);

    expect(m.target.textContent).toContain(MINE);
    // The tail replaces the stale window; the two are never joined over a hole.
    expect(m.target.textContent).not.toContain('body 2');
    expect(m.target.textContent).toContain('body 52');
  });

  it('keeps the restored window when fresh page data with a gap arrives WITHOUT a post (the reader keeps their place)', async () => {
    const { m, props } = await mountRestored();
    props.messages = [...range(52, 70), mine(71)];
    props.total = 71;
    await tick(4);
    expect(m.target.textContent).toContain('body 2');
    expect(m.target.textContent).not.toContain(MINE);
  });

  it('does not jump on a FAILED post', async () => {
    const { m, props } = await mountRestored();
    navigationHooks.onInvalidateAll = () => {
      props.messages = range(52, 71);
      props.total = 71;
    };
    const failed = await posted('draft', { type: 'error', text: 'Failed to post.' });
    await submitEnhancedWithResult(formOf(m), { type: 'failure', status: 500, data: { form: failed } });
    await tick(4);
    expect(m.target.textContent).toContain('body 2');
    expect(m.target.textContent).not.toContain('body 71');
  });

  it('a jump is one-shot: later gap-bearing page data after the post keeps the window again', async () => {
    const { m, props } = await mountRestored();
    navigationHooks.onInvalidateAll = () => {
      props.messages = [...range(52, 70), mine(71)];
      props.total = 71;
    };
    const ok = await posted(MINE, { type: 'success', text: 'Posted to the team chat.' });
    await submitEnhancedWithResult(formOf(m), { type: 'success', status: 200, data: { form: ok } });
    await tick(4);
    expect(m.target.textContent).toContain(MINE);
    props.messages = range(200, 219);
    props.total = 219;
    await tick(4);
    expect(m.target.textContent).toContain(MINE);
    expect(m.target.textContent).not.toContain('body 219');
  });
});
