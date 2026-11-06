/**
 * #1137 — the team chat's team filter, mounted.
 *
 * CLIENT lane: what matters is what the thread RENDERS and ASKS FOR as a filter
 * and the props change around it. The filter is read by the server and arrives
 * as new props; nothing here may filter rows the component already holds.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
import type { TeamChatFilter } from '$lib/team-chat-filter';
import type { TeamChatMessage } from '$lib/types';
import TeamChatThread from './TeamChatThread.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  Reflect.deleteProperty(document, 'hidden');
  vi.useRealTimers();
});

const message = (seq: number, over: Partial<TeamChatMessage> = {}): TeamChatMessage => ({
  nodeId: `m${seq}`,
  seq,
  body: `body ${seq}`,
  at: '2026-10-27T12:00:00.000Z',
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
const ADA = { headId: 'head-ada', label: 'team.ada' };
const BO = { headId: 'head-bo', label: 'team.bo' };

async function mountThread(props: Record<string, unknown>) {
  setStubPage('https://example.test/app/apps/a1', { appId: 'a1' });
  // Assigned onto the SAME object rather than spread into a copy: a copy would
  // freeze the values, and the reactive-props tests below change them.
  props.postForm = await superValidate(zod4(postTeamChatMessageSchema), { errors: false });
  const m = mountComponent(TeamChatThread as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m;
}
const q = (m: Mounted<Record<string, unknown>>, id: string) => m.target.querySelector(`[data-testid="${id}"]`);
const qa = (m: Mounted<Record<string, unknown>>, id: string) => Array.from(m.target.querySelectorAll(`[data-testid="${id}"]`));

describe('TeamChatThread team filter — chips', () => {
  it('draws a chip per stored tag, keyed by head id, and none for null or [] (no claim either way)', async () => {
    const m = await mountThread({
      messages: [
        message(1, { teamTags: [ADA] }),
        message(2, { teamTags: [] }), // known no-team post
        message(3, { teamTags: null }), // absent OR withheld, indistinguishable
        message(4, { teamTags: [ADA, { headId: 'head-ada', label: 'team.ada-again' }, BO] }),
      ],
      total: 4,
      onSelectTeam: vi.fn(),
    });
    expect(qa(m, 'team-chat-tag').map((el) => el.textContent)).toEqual(['team.ada', 'team.ada', 'team.bo']);
    const rows = Array.from(m.target.querySelectorAll('.group'));
    expect(rows[1].querySelector('[data-testid="team-chat-tag"]')).toBeNull();
    expect(rows[2].querySelector('[data-testid="team-chat-tag"]')).toBeNull();
    // Never an "untagged"/"private" claim drawn from a null.
    expect(m.target.textContent).not.toMatch(/private|untagged/i);
  });

  it('asks for the filter by head id, not by label, when a chip is clicked', async () => {
    const onSelectTeam = vi.fn();
    const m = await mountThread({
      messages: [message(1, { teamTags: [{ headId: 'head-ada', label: 'same label' }] }), message(2, { teamTags: [{ headId: 'head-bo', label: 'same label' }] })],
      total: 2,
      onSelectTeam,
    });
    (qa(m, 'team-chat-tag')[1] as HTMLButtonElement).click();
    expect(onSelectTeam).toHaveBeenCalledWith({ kind: 'team', headRef: 'head-bo' });
  });
});

describe('TeamChatThread team filter — the control', () => {
  it('is absent when no tag has been observed (a default-OFF server must not seem to promise results)', async () => {
    const m = await mountThread({ messages: [message(1), message(2, { teamTags: [] })], total: 2, onSelectTeam: vi.fn() });
    expect(q(m, 'team-chat-filter')).toBeNull();
  });

  it('appears once a loaded row carries a tag, offering All / untagged', async () => {
    const onSelectTeam = vi.fn();
    const m = await mountThread({ messages: [message(1, { teamTags: [ADA] })], total: 1, onSelectTeam });
    const bar = q(m, 'team-chat-filter')!;
    expect(bar).not.toBeNull();
    const untagged = Array.from(bar.querySelectorAll('button')).find((b) => b.textContent?.includes('No team tag recorded'))!;
    untagged.click();
    expect(onSelectTeam).toHaveBeenCalledWith({ kind: 'untagged' });
    expect(bar.textContent).not.toMatch(/\d+ earlier/); // no invented count
  });

  it('stays visible under an active filter even when the result is empty, so it can be cleared', async () => {
    const onSelectTeam = vi.fn();
    const m = await mountThread({ messages: [], total: 0, filter: { kind: 'team', headRef: 'head-ada' }, onSelectTeam });
    expect(q(m, 'team-chat-filter-empty')!.textContent).toContain('No messages with this team tag');
    // Never the quiet-team empty state.
    expect(m.target.textContent).not.toContain('No messages in the team chat yet');
    (q(m, 'team-chat-filter-active') as HTMLButtonElement).click();
    expect(onSelectTeam).toHaveBeenCalledWith({ kind: 'none' });
    expect(q(m, 'team-chat-filter-note')!.textContent).toContain('before team tagging carry no tag');
  });

  it('labels an active head from a loaded tag, for display only', async () => {
    const m = await mountThread({
      messages: [message(1, { teamTags: [ADA] })], total: 1, filter: { kind: 'team', headRef: 'head-ada' }, onSelectTeam: vi.fn(),
    });
    expect(q(m, 'team-chat-filter-active')!.textContent).toContain('team.ada');
    expect(qa(m, 'team-chat-tag')[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('says "no team tag recorded" for the untagged view, never absent-vs-empty', async () => {
    const m = await mountThread({ messages: [], total: 0, filter: { kind: 'untagged' }, onSelectTeam: vi.fn() });
    expect(q(m, 'team-chat-filter-empty')!.textContent).toContain('No messages without a team tag.');
    expect(q(m, 'team-chat-filter-note')!.textContent).toContain('no team tag recorded');
  });

  it('shows the server refusal verbatim, and an invalid ?team= as nothing loaded — never the unfiltered rows', async () => {
    const text = 'Team broadcast target is unavailable in this Channel.';
    const refused = await mountThread({
      messages: [], total: 0, loadError: true, filter: { kind: 'team', headRef: 'gone' },
      refusal: { code: 'TEAM_CHAT_TEAM_HEAD_INVALID', message: text }, onSelectTeam: vi.fn(),
    });
    expect(q(refused, 'team-chat-filter-refused')!.textContent!.trim()).toBe(text);
    expect(refused.target.textContent).not.toContain('No messages with this team tag');

    const invalid = await mountThread({ messages: [], total: 0, loadError: true, filterInvalid: true, onSelectTeam: vi.fn() });
    expect(q(invalid, 'team-chat-filter-invalid')).not.toBeNull();
  });
});

describe('TeamChatThread team filter — reset and stale reads', () => {
  it('replaces the accumulated transcript, cursors and counts when the filter changes, even to identical rows', async () => {
    const props = reactiveProps<Record<string, unknown>>({
      messages: [message(1, { teamTags: [ADA] }), message(2, { teamTags: [ADA] })], total: 2, filter: { kind: 'none' } as TeamChatFilter, onSelectTeam: vi.fn(),
    });
    const m = await mountThread(props);
    expect(m.target.textContent).toContain('body 2');
    props.filter = { kind: 'team', headRef: 'head-bo' };
    props.messages = [];
    props.total = 0;
    await tick(3);
    expect(m.target.textContent).not.toContain('body 1');
    expect(q(m, 'team-chat-filter-empty')).not.toBeNull();
  });

  it('drops a poll that was in flight under the previous filter', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    vi.useFakeTimers();
    let release!: (v: { items: TeamChatMessage[]; total: number; loadFailed: boolean }) => void;
    const onRefresh = vi.fn(() => new Promise<{ items: TeamChatMessage[]; total: number; loadFailed: boolean }>((r) => (release = r)));
    const props = reactiveProps<Record<string, unknown>>({
      messages: [message(1, { teamTags: [ADA] })], total: 1, filter: { kind: 'none' } as TeamChatFilter, onRefresh, pollMs: 100, onSelectTeam: vi.fn(),
    });
    const m = await mountThread(props);
    await vi.advanceTimersByTimeAsync(100);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    // The reader picks a team. Only the FILTER changes here — the loader's rows
    // may well be the same (both empty, say), and a different filter is still a
    // different thread…
    props.filter = { kind: 'team', headRef: 'head-bo' };
    await tick(3);
    // …so the unfiltered poll that lands AFTER it must be dropped.
    release({ items: [message(2, { teamTags: [ADA] })], total: 2, loadFailed: false });
    await vi.advanceTimersByTimeAsync(0);
    await tick(3);
    expect(m.target.textContent).not.toContain('body 2');
  });
});

describe('TeamChatThread team filter — invalid and refused reads (#1137 review)', () => {
  const REFUSAL = { code: 'TEAM_CHAT_TEAM_HEAD_INVALID', message: 'Team broadcast target is unavailable in this Channel.' };

  it('never polls or pages while the filter is invalid; only the loader state it was given', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    vi.useFakeTimers();
    const onRefresh = vi.fn(async () => ({ items: [], total: 0, loadFailed: false }));
    const onLoadOlder = vi.fn(async () => ({ items: [], total: 0 }));
    const m = await mountThread({
      messages: [], total: 0, loadError: true, filterInvalid: true, onRefresh, onLoadOlder, pollMs: 100, onSelectTeam: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onLoadOlder).not.toHaveBeenCalled();
    expect(q(m, 'team-chat-filter-invalid')).not.toBeNull();
  });

  it('shows a typed refusal from a poll verbatim instead of the empty-result state, and stops polling', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    vi.useFakeTimers();
    const onRefresh = vi.fn(async () => ({ items: [], total: 0, loadFailed: true, refusal: REFUSAL }));
    const m = await mountThread({
      messages: [], total: 0, filter: { kind: 'team', headRef: 'gone' }, onRefresh, pollMs: 100, onSelectTeam: vi.fn(),
    });
    expect(q(m, 'team-chat-filter-empty')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    await tick(3);
    expect(q(m, 'team-chat-filter-refused')!.textContent!.trim()).toBe(REFUSAL.message);
    expect(q(m, 'team-chat-filter-empty')).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows a typed refusal from an older page verbatim', async () => {
    const onLoadOlder = vi.fn(async () => ({ refusal: REFUSAL }));
    const m = await mountThread({
      messages: [message(5, { teamTags: [ADA] })], total: 9, filter: { kind: 'team', headRef: 'head-ada' }, onLoadOlder, onSelectTeam: vi.fn(),
    });
    const btn = Array.from(m.target.querySelectorAll('button')).find((b) => /earlier/i.test(b.textContent ?? ''));
    expect(btn).toBeTruthy();
    btn!.click();
    await tick(4);
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
    expect(q(m, 'team-chat-filter-refused')!.textContent!.trim()).toBe(REFUSAL.message);
  });

  it('clears a live refusal when fresh page data (another filter) arrives', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    vi.useFakeTimers();
    const onRefresh = vi.fn(async () => ({ items: [], total: 0, loadFailed: true, refusal: REFUSAL }));
    const props = reactiveProps<Record<string, unknown>>({
      messages: [], total: 0, filter: { kind: 'team', headRef: 'gone' } as TeamChatFilter, onRefresh, pollMs: 100, onSelectTeam: vi.fn(),
    });
    const m = await mountThread(props);
    await vi.advanceTimersByTimeAsync(100);
    await tick(3);
    expect(q(m, 'team-chat-filter-refused')).not.toBeNull();
    props.filter = { kind: 'none' };
    await tick(3);
    expect(q(m, 'team-chat-filter-refused')).toBeNull();
  });
});

it('cached transcript restoration never merges an old filter into a new filter', async () => {
  const props = reactiveProps({
    messages: [message(2, { teamTags: [ADA] })], total: 2,
    filter: { kind: 'team', headRef: ADA.headId } as TeamChatFilter,
    onViewStateChange: vi.fn(),
    viewState: { items: [message(1, { teamTags: [ADA] }), message(2, { teamTags: [ADA] })], total: 2,
      pendingNewer: 0, olderRemaining: 0, olderExhausted: true, scrollTop: 0, atBottom: true },
  });
  const m = await mountThread(props);
  expect(m.target.textContent).toContain('body 1');
  props.messages = [message(3, { teamTags: [BO] })];
  props.total = 1;
  props.filter = { kind: 'team', headRef: BO.headId };
  await tick(3);
  expect(m.target.textContent).toContain('body 3');
  expect(m.target.textContent).not.toContain('body 1');
  expect(m.target.textContent).not.toContain('body 2');
});
