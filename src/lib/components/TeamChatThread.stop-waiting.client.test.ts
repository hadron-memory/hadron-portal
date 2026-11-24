/**
 * portal#2542: a post the server never answers can be abandoned.
 *
 * CLIENT lane: the control, the abort and the focus return live in the mounted
 * component. The assertion that matters is on the REQUEST's own signal (the
 * controller superforms handed kit), not on a mocked callback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { lastRequestSignal, submitEnhancedDeferred } from '$lib/test/stubs/app-forms';
import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
import { POST_PENDING_BOUND_MS } from '$lib/team-chat-refresh';
import TeamChatThread from './TeamChatThread.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.useRealTimers();
});

async function mountComposer(onSubmittingChange: (submitting: boolean) => void = () => {}) {
  setStubPage('https://example.test/app/apps/a1', { appId: 'a1' });
  const postForm = await superValidate(zod4(postTeamChatMessageSchema), { errors: false });
  const m = mountComponent(TeamChatThread as never, {
    messages: [], total: 0, postForm, workerUrns: null, onSubmittingChange,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m;
}

async function startPost(target: HTMLElement, body: string) {
  const composer = target.querySelector<HTMLTextAreaElement>('#team-chat-body')!;
  composer.value = body;
  composer.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(2);
  const form = target.querySelector('form')!;
  const pending = await submitEnhancedDeferred(form);
  await tick(2);
  return { composer, form, pending };
}

const stopButton = (t: HTMLElement) => t.querySelector<HTMLButtonElement>('[data-testid="team-chat-stop-waiting"]');
const note = (t: HTMLElement) => t.querySelector('[data-testid="team-chat-post-stalled"] p');
const postButton = (t: HTMLElement) => t.querySelector<HTMLButtonElement>('button[type="submit"]')!;

async function stall() {
  await vi.advanceTimersByTimeAsync(POST_PENDING_BOUND_MS);
  await tick(2);
}

describe('TeamChatThread — Stop waiting (#2542)', () => {
  it('shows the control with the stalled note, and Stop waiting aborts the request itself', async () => {
    vi.useFakeTimers();
    const busy = vi.fn();
    const { target } = await mountComposer(busy);
    const { composer, form } = await startPost(target, 'never answered');
    expect(stopButton(target)).toBeNull();
    await stall();
    expect(note(target)).not.toBeNull();
    expect(stopButton(target)?.type).toBe('button');
    expect(lastRequestSignal(form).aborted).toBe(false);

    stopButton(target)!.click();
    await vi.advanceTimersByTimeAsync(0);
    await tick(3);

    // Kills: calling only the cancel (no abort), or only the abort (superforms stays `submitting`).
    expect(lastRequestSignal(form).aborted).toBe(true);
    expect(stopButton(target)).toBeNull();
    // Post is enabled with the draft, so the region keeps saying the message may have gone (UX seat P2):
    // the stalled wording is replaced, in the same live region, not removed.
    expect(note(target)?.textContent).toMatch(/You stopped waiting.*may already have been sent/);
    expect(note(target)?.textContent).not.toMatch(/has not answered/);
    expect(composer.disabled).toBe(false);
    expect(composer.value).toBe('never answered');
    expect(postButton(target).disabled).toBe(false);
    expect(postButton(target).textContent?.trim()).toBe('Post');
    expect(busy).toHaveBeenLastCalledWith(false);
    // Focus returns to the composer: the button that held it is gone.
    expect(document.activeElement).toBe(composer);

    // Editing the draft is the reader acting on it: the note goes.
    composer.value = 'never answered, edited';
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(2);
    expect(note(target)).toBeNull();
  });

  it('posting again after Stop waiting clears the stopped note', async () => {
    vi.useFakeTimers();
    const { target } = await mountComposer();
    const first = await startPost(target, 'retry');
    await stall();
    stopButton(target)!.click();
    await tick(3);
    expect(note(target)).not.toBeNull();
    await submitEnhancedDeferred(first.form);
    await tick(2);
    expect(note(target)).toBeNull();
  });

  it('a post that settles before the bound shows neither the note nor the control', async () => {
    vi.useFakeTimers();
    const { target } = await mountComposer();
    const { pending } = await startPost(target, 'quick');
    await vi.advanceTimersByTimeAsync(POST_PENDING_BOUND_MS - 1);
    await tick(2);
    expect(stopButton(target)).toBeNull();
    const f = await superValidate({ _kind: 'postTeamChatMessage', body: 'quick' }, zod4(postTeamChatMessageSchema), { errors: false });
    await pending.finish({ type: 'success', status: 200, data: { form: { ...f, valid: true, message: { type: 'success', text: 'Posted.' } } } });
    await tick(4);
    await vi.advanceTimersByTimeAsync(POST_PENDING_BOUND_MS * 2);
    await tick(2);
    expect(note(target)).toBeNull();
    expect(stopButton(target)).toBeNull();
  });

  it('a late answer after Stop waiting neither re-locks the thread nor brings the note back', async () => {
    vi.useFakeTimers();
    const busy = vi.fn();
    const { target } = await mountComposer(busy);
    const { composer, form, pending } = await startPost(target, 'abandoned');
    const first = lastRequestSignal(form);
    await stall();
    stopButton(target)!.click();
    await tick(3);

    const f = await superValidate({ _kind: 'postTeamChatMessage', body: 'abandoned' }, zod4(postTeamChatMessageSchema), { errors: false });
    await pending.finish({ type: 'success', status: 200, data: { form: { ...f, valid: true, message: { type: 'success', text: 'Posted.' } } } });
    await tick(4);
    await vi.advanceTimersByTimeAsync(POST_PENDING_BOUND_MS * 2);
    await tick(2);
    // The first request stays aborted, and the late result neither re-locks the thread nor re-shows the note.
    expect(first.aborted).toBe(true);
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(stopButton(target)).toBeNull();
    expect(composer.disabled).toBe(false);
  });

  it('after Stop waiting the reader can post again, and that post gets its own request', async () => {
    vi.useFakeTimers();
    const { target } = await mountComposer();
    const first = await startPost(target, 'again');
    const firstSignal = lastRequestSignal(first.form);
    await stall();
    stopButton(target)!.click();
    await tick(3);
    const second = await submitEnhancedDeferred(first.form);
    await tick(2);
    // The second Post click is a new request with its own signal, still open.
    const secondSignal = lastRequestSignal(first.form);
    expect(secondSignal).not.toBe(firstSignal);
    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);
  });

  it('leaving a stalled post and coming back finds no first request still open (#2540 seat P3)', async () => {
    vi.useFakeTimers();
    const first = await mountComposer();
    const { form } = await startPost(first.target, 'left behind');
    const signal = lastRequestSignal(form);
    await stall();
    expect(signal.aborted).toBe(false);
    mounted.pop()!.unmount();
    // Kills: no teardown abort, so the first request stays open under a fresh, enabled Post.
    expect(signal.aborted).toBe(true);
    const back = await mountComposer();
    expect(postButton(back.target).textContent?.trim()).toBe('Post');
    expect(back.target.querySelector<HTMLTextAreaElement>('#team-chat-body')!.disabled).toBe(false);
  });

  it('Stop waiting unlocks the form even if the abort throws', async () => {
    vi.useFakeTimers();
    const { target } = await mountComposer();
    const { composer } = await startPost(target, 'abort throws');
    await stall();
    const abort = vi.spyOn(AbortController.prototype, 'abort').mockImplementation(() => {
      throw new Error('abort failed');
    });
    const swallow = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', swallow);
    try {
      stopButton(target)!.click();
      await tick(3);
      // Kills: running `cancel` after the abort without try/finally, which leaves the form submitting.
      expect(composer.disabled).toBe(false);
      expect(postButton(target).textContent?.trim()).toBe('Post');
    } finally {
      window.removeEventListener('error', swallow);
      abort.mockRestore();
    }
  });

  it('leaving a stalled post releases the parent page lock', async () => {
    vi.useFakeTimers();
    const busy = vi.fn();
    const m = await mountComposer(busy);
    await startPost(m.target, 'parent lock');
    await stall();
    mounted.pop()!.unmount();
    expect(busy).toHaveBeenLastCalledWith(false);
  });

  it('leaving while the post is still young does not abort it', async () => {
    vi.useFakeTimers();
    const m = await mountComposer();
    const { form } = await startPost(m.target, 'young');
    const signal = lastRequestSignal(form);
    mounted.pop()!.unmount();
    expect(signal.aborted).toBe(false);
  });
});
