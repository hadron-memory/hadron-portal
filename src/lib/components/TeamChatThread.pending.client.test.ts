/**
 * #1407: a post the server never answers must not lock the page for good.
 *
 * CLIENT lane: the bound is a timer started when superforms reports
 * `submitting`, so only a mounted thread with fake timers can see it.
 * `submitEnhanced` runs superforms' own submit callback and never delivers a
 * result, which is exactly a post that never settles.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { submitEnhanced, submitEnhancedDeferred } from '$lib/test/stubs/app-forms';
import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
import { POST_PENDING_BOUND_MS } from '$lib/team-chat-refresh';
import TeamChatThread from './TeamChatThread.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.useRealTimers();
});

async function mountComposer(onSubmittingChange: (submitting: boolean) => void) {
  setStubPage('https://example.test/app/apps/a1', { appId: 'a1' });
  const postForm = await superValidate(zod4(postTeamChatMessageSchema), { errors: false });
  const m = mountComponent(TeamChatThread as never, {
    messages: [], total: 0, postForm, workerUrns: null, onSubmittingChange,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

async function startPost(target: HTMLElement, body: string) {
  const composer = target.querySelector<HTMLTextAreaElement>('#team-chat-body')!;
  composer.value = body;
  composer.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(2);
  await submitEnhanced(target.querySelector('form')!);
  await tick(2);
  return composer;
}

const region = (t: HTMLElement) => t.querySelector('[data-testid="team-chat-post-stalled"]')!;
const stalled = (t: HTMLElement) => region(t).querySelector('p');

describe('TeamChatThread — a post that never settles (#1407)', () => {
  it('holds the page busy while the post is young, then releases it and keeps the draft', async () => {
    vi.useFakeTimers();
    const busy = vi.fn();
    const target = await mountComposer(busy);
    const composer = await startPost(target, 'hello team');

    expect(busy).toHaveBeenLastCalledWith(true);
    expect(region(target)).not.toBeNull();
    expect(stalled(target)).toBeNull();

    await vi.advanceTimersByTimeAsync(POST_PENDING_BOUND_MS - 1);
    await tick(2);
    expect(busy).toHaveBeenLastCalledWith(true);
    expect(stalled(target)).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    await tick(2);
    expect(busy).toHaveBeenLastCalledWith(false);
    const note = stalled(target);
    // The region was mounted, empty, before the note arrived, so it is announced.
    expect(region(target).getAttribute('role')).toBe('status');
    expect(note?.textContent).toMatch(/may still be sent/);
    // The draft is still there, and the request is still open, so Post stays
    // disabled: waiting cannot double-send.
    expect(composer.value).toBe('hello team');
    expect(target.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });

  it('a thread torn down mid-post releases the page lock and never reports a late stall', async () => {
    vi.useFakeTimers();
    const busy = vi.fn();
    const target = await mountComposer(busy);
    await startPost(target, 'quick');
    expect(busy).toHaveBeenLastCalledWith(true);
    mounted.pop()!.unmount();
    expect(busy).toHaveBeenLastCalledWith(false);
    const calls = busy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POST_PENDING_BOUND_MS * 2);
    expect(busy.mock.calls.length).toBe(calls);
  });

  async function postedOk(body: string) {
    const f = await superValidate({ _kind: 'postTeamChatMessage', body }, zod4(postTeamChatMessageSchema), { errors: false });
    return { ...f, valid: true, message: { type: 'success' as const, text: 'Posted.' } };
  }
  async function startDeferred(target: HTMLElement, body: string) {
    const composer = target.querySelector<HTMLTextAreaElement>('#team-chat-body')!;
    composer.value = body;
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(2);
    const pending = await submitEnhancedDeferred(target.querySelector('form')!);
    await tick(2);
    return { composer, pending };
  }

  it('a late answer after the stall clears the note, re-enables Post and leaves the page unlocked', async () => {
    vi.useFakeTimers();
    const busy = vi.fn();
    const target = await mountComposer(busy);
    const { pending } = await startDeferred(target, 'late one');
    await vi.advanceTimersByTimeAsync(POST_PENDING_BOUND_MS);
    await tick(2);
    expect(stalled(target)).not.toBeNull();

    await pending.finish({ type: 'success', status: 200, data: { form: await postedOk('late one') } });
    await tick(4);
    // Kills: dropping `postStalled = false` in the not-submitting branch.
    expect(stalled(target)).toBeNull();
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(target.querySelector<HTMLTextAreaElement>('#team-chat-body')!.disabled).toBe(false);
  });

  it('a post that settles before the bound never shows the note, and its timer never fires', async () => {
    vi.useFakeTimers();
    const busy = vi.fn();
    const target = await mountComposer(busy);
    const { pending } = await startDeferred(target, 'quick one');
    await pending.finish({ type: 'success', status: 200, data: { form: await postedOk('quick one') } });
    await tick(4);
    const calls = busy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POST_PENDING_BOUND_MS * 2);
    await tick(2);
    expect(stalled(target)).toBeNull();
    expect(busy.mock.calls.length).toBe(calls);
  });
});
