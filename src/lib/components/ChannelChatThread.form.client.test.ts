/**
 * #1407 pins on how the Channel/team composer takes a form result.
 *
 * Each case names the mutant it kills. Mounted, because the behaviour sits in
 * the component's reaction to a result, not in a pure function.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { page, setStubPage } from '$lib/test/stubs/app-stores';
import { resetKitAppliedResults, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
import ChannelChatThread from './ChannelChatThread.svelte';
import TeamChatThread from './TeamChatThread.svelte';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; resetKitAppliedResults(); vi.unstubAllGlobals(); });

const REFUSED = 'Could not post to this chat. Your message has been kept; check your access and try again.';

async function failed(id: string, body: string) {
  const f = await superValidate({ _kind: 'postTeamChatMessage', channelRef: id.replace('channel:', ''), body }, zod4(postTeamChatMessageSchema), { id, errors: false });
  f.message = { type: 'error', text: REFUSED };
  return f;
}

async function mountChannel(form: unknown, extra: Record<string, unknown> = {}) {
  setStubPage('http://localhost/app/apps/a?tab=chats', { appId: 'a' });
  const postForm = await superValidate({ channelRef: 'pair' }, zod4(postTeamChatMessageSchema), { id: 'channel:pair', errors: false });
  mounted = mountComponent(ChannelChatThread as never, {
    appId: 'a', channelId: 'pair', messages: [], total: 0, loadError: false, postForm, form,
    action: '?/postChannelMessage', workerUrns: null, onDraftChange: vi.fn(), ...extra,
  } as never) as Mounted<Record<string, unknown>>;
  await tick(3);
  return mounted.target;
}
const composer = (t: HTMLElement) => t.querySelector<HTMLTextAreaElement>('textarea[name=body]')!;

describe('Channel composer: form-result isolation (#1407)', () => {
  it('seeds a failed draft and its error only from a form that is THIS Channel\'s', async () => {
    const own = await mountChannel({ form: await failed('channel:pair', 'my refused draft') });
    expect(composer(own).value).toBe('my refused draft');
    expect(own.textContent).toContain('Your message has been kept');
    mounted!.unmount();
    // Not a mutant killer for scopedForm alone: the thread it wraps re-checks the
    // form id (matchingSubmission), so removing scopedForm's check is equivalent.
    // The wrapped pair is what is pinned; matchingSubmission has its own case below.
    const foreign = await mountChannel({ form: await failed('channel:other', 'another chat\'s draft') });
    expect(composer(foreign).value).toBe('');
    expect(foreign.textContent).not.toContain('Your message has been kept');
  });

  it('ignores action data that is not a post form at all', async () => {
    const t = await mountChannel({ pauseResult: { ok: false, workerId: 'w', message: 'x' } });
    expect(composer(t).value).toBe('');
  });
});

describe('Team composer: form-result isolation (#1407)', () => {
  it('seeds a failed draft only from a form whose id is the thread\'s postForm id', async () => {
    setStubPage('http://localhost/app/apps/a?tab=chats', { appId: 'a' });
    const postForm = await superValidate(zod4(postTeamChatMessageSchema), { id: 'team', errors: false });
    const mountTeam = async (form: unknown) => {
      mounted = mountComponent(TeamChatThread as never, { messages: [], total: 0, postForm, form, workerUrns: null } as never) as Mounted<Record<string, unknown>>;
      await tick(3);
      return mounted.target;
    };
    const own = await mountTeam({ form: await failed('team', 'team draft') });
    expect(composer(own).value).toBe('team draft');
    mounted!.unmount();
    // Kills: matchingSubmission matching any form.
    const foreign = await mountTeam({ form: await failed('channel:pair', 'channel draft') });
    expect(composer(foreign).value).toBe('');
  });
});

describe('Cached composer: the applyAction:never branch (#1407)', () => {
  // `applyAction: 'never'` is truthy for superforms' result path, so a returned
  // result is still applied. What it switches off is the page-store branch that
  // rebinds the form from a loader form of the same id, i.e. a page reload
  // landing a fresh EMPTY form over an unsent draft.
  async function reload(t: HTMLElement) {
    const fresh = await superValidate({ channelRef: 'pair' }, zod4(postTeamChatMessageSchema), { id: 'channel:pair', errors: false });
    page.update((p) => ({ ...p, status: 200, data: { ...(p.data as object), postChannelMessageForm: fresh } }));
    await tick(3);
    return composer(t).value;
  }
  async function typed(t: HTMLElement) {
    composer(t).value = 'unsent draft';
    composer(t).dispatchEvent(new Event('input', { bubbles: true }));
    await tick(2);
  }

  it('a page reload with a fresh empty form leaves an unsent draft alone when the parent owns the draft', async () => {
    const t = await mountChannel(null, { onDraftChange: vi.fn() });
    await typed(t);
    expect(await reload(t)).toBe('unsent draft');
  });

  it('the standalone composer is reseeded by the same reload, so the two stay different', async () => {
    const t = await mountChannel(null, { onDraftChange: undefined });
    await typed(t);
    expect(await reload(t)).toBe('');
  });
});

describe('The function-form submitEnhancedWithResult callback (#1407)', () => {
  it('actually runs, and runs while the post is still pending', async () => {
    const t = await mountChannel(null);
    composer(t).value = 'hello'; composer(t).dispatchEvent(new Event('input', { bubbles: true })); await tick(2);
    let ran = false;
    let postingText = '';
    await submitEnhancedWithResult(
      t.querySelector('form')!,
      { type: 'success', status: 200, data: { form: await superValidate({ channelRef: 'pair', body: 'hello' }, zod4(postTeamChatMessageSchema), { id: 'channel:pair', errors: false }) } },
      async () => { ran = true; postingText = t.querySelector<HTMLButtonElement>('button[type=submit]')!.textContent ?? ''; },
    );
    // An assertion inside the callback is skipped silently if the callback never
    // runs, so the flag is what proves it did.
    expect(ran).toBe(true);
    expect(postingText).toContain('Posting');
  });
});
