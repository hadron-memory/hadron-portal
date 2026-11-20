/**
 * portal#1238 — an unsent draft from one chat must never appear in another
 * chat's composer. The report is a single cold-dev observation that never
 * reproduced, so this file is the deterministic regression cut the gate asked
 * for: synthetic mounted controls on the REAL App page, with exact draft and
 * reply-target assertions. It claims nothing about the one-off cold-start
 * sighting; it pins the boundary the report was about.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { page, setStubPage } from '$lib/test/stubs/app-stores';
import { resetKitAppliedResults, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
import Page from './+page.svelte';
import { message, pageData } from './app-page.fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetKitAppliedResults();
  window.history.replaceState({}, '', '/');
});

type Data = Awaited<ReturnType<typeof pageData>>;

async function chats() {
  setStubPage('http://localhost/app/apps/a1?tab=chats', { appId: 'a1' });
  const base = await pageData();
  const team = { ...base, initialTab: 'chats', teamChatMessages: [message(1, 'w1')], teamChatTotal: 1 } as Data;
  const channel = async (id: string) => ({
    ...team, selectedChatKey: id, selectedChannelId: id,
    selectedChannelMessages: [{ ...message(1, 'w1'), body: `message in ${id}` }],
    selectedChannelTotal: 1, selectedChannelError: false,
    postChannelMessageForm: await superValidate({ channelRef: id }, zod4(postTeamChatMessageSchema), { errors: false, id: `channel:${id}` }),
  }) as Data;
  const ops = await channel('ops');
  const props = reactiveProps<Record<string, unknown>>({ data: team, form: null });
  page.update((p) => ({ ...p, data: team }));
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  const show = async (data: Data) => {
    page.update((p) => ({ ...p, data }));
    flushSync(() => { props.data = data; });
    await tick(2);
  };
  const composer = () => m.target.querySelector<HTMLTextAreaElement>('textarea[name=body]')!;
  const type = (text: string) => {
    const el = composer();
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  };
  const hidden = (name: string) => m.target.querySelector<HTMLInputElement>(`input[type=hidden][name=${name}]`)?.value;
  return { m, props, team, ops, channel, show, composer, type, hidden };
}

describe('draft isolation across chats (#1238)', () => {
  it('keeps each chat’s draft exact through team → ops → team → ops, never concatenated', async () => {
    const { team, ops, show, composer, type, hidden } = await chats();
    type('team-draft-1');
    await show(ops);
    // The observed symptom was the team text sitting in the ops composer, then
    // concatenating with what the user typed there.
    expect(composer().value).toBe('');
    expect(hidden('channelRef')).toBe('ops');
    type('ops-draft-1');
    await show(team);
    expect(composer().value).toBe('team-draft-1');
    expect(hidden('channelRef')).toBe('');
    await show(ops);
    expect(composer().value).toBe('ops-draft-1');
    expect(hidden('channelRef')).toBe('ops');
    await show(team);
    expect(composer().value).toBe('team-draft-1');
  });

  it('isolates a reply target: it follows its own chat only', async () => {
    const { m, team, ops, show, composer, type, hidden } = await chats();
    const reply = [...m.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Reply')!;
    reply.click();
    flushSync();
    type('answering the team');
    expect(hidden('replyToSeq')).toBe('1');
    await show(ops);
    expect(m.target.textContent).not.toContain('Replying to #1');
    expect(hidden('replyToSeq')).toBe('');
    expect(composer().value).toBe('');
    type('ops text, no reply');
    await show(team);
    expect(composer().value).toBe('answering the team');
    expect(hidden('replyToSeq')).toBe('1');
    expect(m.target.textContent).toContain('Replying to');
    await show(ops);
    expect(hidden('replyToSeq')).toBe('');
    expect(composer().value).toBe('ops text, no reply');
  });

  it('a reply started with no text typed yet still returns with its chat', async () => {
    const { m, team, ops, show, hidden } = await chats();
    [...m.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Reply')!.click();
    flushSync();
    expect(hidden('replyToSeq')).toBe('1');
    await show(ops);
    expect(hidden('replyToSeq')).toBe('');
    await show(team);
    // No keystroke re-sent the target: only the stored draft can restore it.
    expect(hidden('replyToSeq')).toBe('1');
  });

  it('survives the page store and the page data landing a tick apart, in either order', async () => {
    const { props, team, ops, show, composer, type } = await chats();
    type('team-draft-1');
    // Store first, data a tick later (a hydration skew), then the reverse.
    page.update((p) => ({ ...p, data: ops }));
    await tick(2);
    expect(composer().value).toBe('team-draft-1');
    flushSync(() => { props.data = ops; });
    await tick(2);
    expect(composer().value).toBe('');
    type('ops-draft-1');
    flushSync(() => { props.data = team; });
    await tick(2);
    page.update((p) => ({ ...p, data: team }));
    await tick(2);
    expect(composer().value).toBe('team-draft-1');
    await show(ops);
    expect(composer().value).toBe('ops-draft-1');
  });

  it.each([true, false])('a post to ops (success=%s) touches only the ops draft', async (success) => {
    const { m, team, ops, show, composer, type } = await chats();
    type('team-draft-1');
    await show(ops);
    type('ops-draft-1');
    const form = composer().closest('form')!;
    const result = await superValidate({ body: 'ops-draft-1', channelRef: 'ops' }, zod4(postTeamChatMessageSchema), { id: 'channel:ops', errors: false });
    result.valid = success;
    result.message = success ? { type: 'success', text: 'Posted.' } : { type: 'error', text: 'Refused; try again.' };
    await submitEnhancedWithResult(form, { type: success ? 'success' : 'failure', status: success ? 200 : 400, data: { form: result } });
    await tick(3);
    expect(composer().value).toBe(success ? '' : 'ops-draft-1');
    expect(m.target.textContent).not.toContain('team-draft-1');
    await show(team);
    expect(composer().value).toBe('team-draft-1');
    await show(ops);
    expect(composer().value).toBe(success ? '' : 'ops-draft-1');
  });

  it('a second Channel never inherits the first Channel’s draft', async () => {
    const { channel, ops, show, composer, type, hidden } = await chats();
    const other = await channel('other');
    await show(ops);
    type('ops-draft-1');
    await show(other);
    expect(composer().value).toBe('');
    expect(hidden('channelRef')).toBe('other');
    type('other-draft-1');
    await show(ops);
    expect(composer().value).toBe('ops-draft-1');
    await show(other);
    expect(composer().value).toBe('other-draft-1');
  });
});
