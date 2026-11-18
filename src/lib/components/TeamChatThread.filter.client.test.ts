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
import { NO_TEAM_FILTER, type TeamChatFilter } from '$lib/team-chat-filter';
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
    expect(onSelectTeam).toHaveBeenCalledWith({ kind: 'teams', headRefs: ['head-bo'] });
  });

  it('toggles further heads into the selection and out of it (#1482)', async () => {
    // The parent answers onSelectTeam with a fresh read that lands as new
    // filter props. Since the #2250 fix round a second click computes
    // against the PENDING request, so "remove" needs the read only to land,
    // not to be awaited before the next click; wire the write-back the way
    // a real parent would.
    const onSelectTeam = vi.fn((next: TeamChatFilter) => { props.filter = next; });
    const props = reactiveProps<Record<string, unknown>>({
      messages: [
        message(1, { teamTags: [ADA] }),
        message(2, { teamTags: [BO] }),
      ],
      total: 2,
      filter: { kind: 'teams', headRefs: ['head-ada'] },
      onSelectTeam,
    });
    const m = await mountThread(props);
    // Both membership states visible on the rows before any click, and the
    // title names the action the click will take (#1482 made it a toggle).
    expect(qa(m, 'team-chat-tag').map((el) => el.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(qa(m, 'team-chat-tag').map((el) => el.getAttribute('title'))).toEqual([
      'Remove this team from the filter',
      'Show messages with this team tag',
    ]);
    // Adding: the set grows, the existing member stays, and once the parent's
    // read lands both rows read as in the set.
    (qa(m, 'team-chat-tag')[1] as HTMLButtonElement).click();
    expect(onSelectTeam).toHaveBeenLastCalledWith({ kind: 'teams', headRefs: ['head-ada', 'head-bo'] });
    await tick(4);
    expect(qa(m, 'team-chat-tag').map((el) => el.getAttribute('aria-pressed'))).toEqual(['true', 'true']);
    expect(qa(m, 'team-chat-tag').every((el) => el.getAttribute('title') === 'Remove this team from the filter')).toBe(true);
    // Removing: that member leaves, the other stays.
    (qa(m, 'team-chat-tag')[0] as HTMLButtonElement).click();
    expect(onSelectTeam).toHaveBeenLastCalledWith({ kind: 'teams', headRefs: ['head-bo'] });
  });

  it('removing the last selected head by its chip asks for no filter at all', async () => {
    const onSelectTeam = vi.fn();
    const m = await mountThread({
      messages: [message(1, { teamTags: [ADA] })],
      total: 1,
      filter: { kind: 'teams', headRefs: ['head-ada'] },
      onSelectTeam,
    });
    (qa(m, 'team-chat-tag')[0] as HTMLButtonElement).click();
    expect(onSelectTeam).toHaveBeenCalledWith(NO_TEAM_FILTER);
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
    const m = await mountThread({ messages: [], total: 0, filter: { kind: 'teams', headRefs: ['head-ada'] }, onSelectTeam });
    expect(q(m, 'team-chat-filter-empty')!.textContent).toContain('No messages match these tags');
    // Never the quiet-team empty state.
    expect(m.target.textContent).not.toContain('No messages in the team chat yet');
    (q(m, 'team-chat-filter-active') as HTMLButtonElement).click();
    expect(onSelectTeam).toHaveBeenCalledWith({ kind: 'none' });
    expect(q(m, 'team-chat-filter-note')!.textContent).toContain('before team tagging carry no tag');
  });

  it('labels an active head from a loaded tag, for display only', async () => {
    const m = await mountThread({
      messages: [message(1, { teamTags: [ADA] })], total: 1, filter: { kind: 'teams', headRefs: ['head-ada'] }, onSelectTeam: vi.fn(),
    });
    expect(q(m, 'team-chat-filter-active')!.textContent).toContain('team.ada');
    expect(qa(m, 'team-chat-tag')[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('draws one removable chip per selected head, labelled from loaded tags, and removes just that head (#1482)', async () => {
    const onSelectTeam = vi.fn();
    const m = await mountThread({
      messages: [message(1, { teamTags: [ADA] }), message(2, { teamTags: [BO] })],
      total: 2,
      filter: { kind: 'teams', headRefs: ['head-ada', 'head-bo'] },
      onSelectTeam,
    });
    const chips = qa(m, 'team-chat-filter-active');
    // One chip per selected head, labelled from loaded tags. The × is
    // decorative; each chip is a plain remove button whose accessible name
    // names ITS OWN head (#2250 fix round), so assert the parts.
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toContain('team.ada');
    expect(chips[1].textContent).toContain('team.bo');
    expect(chips[0].getAttribute('aria-label')).toBe('Remove team.ada from the filter');
    expect(chips[1].getAttribute('aria-label')).toBe('Remove team.bo from the filter');
    expect(chips.every((el) => el.hasAttribute('aria-pressed'))).toBe(false);
    // Removing one chip keeps the other (the parent re-reads under the smaller
    // set; onSelectTeam is the contract for it).
    (chips[0] as HTMLButtonElement).click();
    expect(onSelectTeam).toHaveBeenCalledWith({ kind: 'teams', headRefs: ['head-bo'] });
    // A selected head with no loaded row still gets its chip. #2250 fix
    // round: the fallback is the head ref itself — several sparse heads used
    // to render identical "Selected team" chips with one accessible name
    // (Georgia's LOCAL P3); the live region keeps its generic name.
    const sparse = await mountThread({
      messages: [message(1, { teamTags: [ADA] })], total: 1,
      filter: { kind: 'teams', headRefs: ['head-ada', 'head-zoe'] }, onSelectTeam: vi.fn(),
    });
    const sparseChips = qa(sparse, 'team-chat-filter-active');
    expect(sparseChips).toHaveLength(2);
    expect(sparseChips[0].textContent).toContain('team.ada');
    expect(sparseChips[1].textContent).toContain('head-zoe');
    expect(sparseChips[1].getAttribute('aria-label')).toBe('Remove head-zoe from the filter');
  });

  it('says "no team tag recorded" for the untagged view, never absent-vs-empty', async () => {
    const m = await mountThread({ messages: [], total: 0, filter: { kind: 'untagged' }, onSelectTeam: vi.fn() });
    expect(q(m, 'team-chat-filter-empty')!.textContent).toContain('No messages without a team tag.');
    expect(q(m, 'team-chat-filter-note')!.textContent).toContain('no team tag recorded');
  });

  it('shows the server refusal verbatim, and an invalid ?team= as nothing loaded — never the unfiltered rows', async () => {
    const text = 'Team broadcast target is unavailable in this Channel.';
    const refused = await mountThread({
      messages: [], total: 0, loadError: true, filter: { kind: 'teams', headRefs: ['gone'] },
      refusal: { code: 'TEAM_CHAT_TEAM_HEAD_INVALID', message: text }, onSelectTeam: vi.fn(),
    });
    expect(q(refused, 'team-chat-filter-refused')!.textContent!.trim()).toBe(text);
    expect(refused.target.textContent).not.toContain('No messages match these tags');

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
    props.filter = { kind: 'teams', headRefs: ['head-bo'] };
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
    props.filter = { kind: 'teams', headRefs: ['head-bo'] };
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
      messages: [], total: 0, filter: { kind: 'teams', headRefs: ['gone'] }, onRefresh, pollMs: 100, onSelectTeam: vi.fn(),
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
      messages: [message(5, { teamTags: [ADA] })], total: 9, filter: { kind: 'teams', headRefs: ['head-ada'] }, onLoadOlder, onSelectTeam: vi.fn(),
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
      messages: [], total: 0, filter: { kind: 'teams', headRefs: ['gone'] } as TeamChatFilter, onRefresh, pollMs: 100, onSelectTeam: vi.fn(),
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
    filter: { kind: 'teams', headRefs: [ADA.headId] } as TeamChatFilter,
    onViewStateChange: vi.fn(),
    viewState: { items: [message(1, { teamTags: [ADA] }), message(2, { teamTags: [ADA] })], total: 2,
      pendingNewer: 0, olderRemaining: 0, olderExhausted: true, scrollTop: 0, atBottom: true },
  });
  const m = await mountThread(props);
  expect(m.target.textContent).toContain('body 1');
  props.messages = [message(3, { teamTags: [BO] })];
  props.total = 1;
  props.filter = { kind: 'teams', headRefs: [BO.headId] };
  await tick(3);
  expect(m.target.textContent).toContain('body 3');
  expect(m.target.textContent).not.toContain('body 1');
  expect(m.target.textContent).not.toContain('body 2');
});

// #2250 fix round (Gil's BLIND P2s + Georgia's F1): pending-request toggles,
// the 20-head cap affordance, per-chip focus targets, and chip identity.
describe('TeamChatThread team filter — pending toggles, cap, focus, chip identity (fix round)', () => {
  const CY = { headId: 'head-cy', label: 'team.cy' };
  const chipFor = (m: Mounted<Record<string, unknown>>, head: string) =>
    m.target.querySelector(`[data-testid="team-chat-filter-active"][data-head="${head}"]`) as HTMLButtonElement | null;

  it('toggles against the pending request while the route-owned read has not landed', async () => {
    // The parent never writes back here: both clicks land while the first
    // goto is still pending, so the second toggle must compute against the
    // REQUESTED set, not the stale prop (BLIND P2: rapid toggles dropped the
    // first selection).
    const onSelectTeam = vi.fn();
    const m = await mountThread({
      messages: [message(1, { teamTags: [ADA] }), message(2, { teamTags: [BO] })],
      total: 2, onSelectTeam,
    });
    const tags = qa(m, 'team-chat-tag');
    (tags[0] as HTMLButtonElement).click();
    expect(onSelectTeam).toHaveBeenLastCalledWith({ kind: 'teams', headRefs: ['head-ada'] });
    (tags[1] as HTMLButtonElement).click();
    expect(onSelectTeam).toHaveBeenLastCalledWith({ kind: 'teams', headRefs: ['head-ada', 'head-bo'] });
  });

  it('reads a second fast click on the same chip as add-then-remove, not add-add', async () => {
    const onSelectTeam = vi.fn();
    const m = await mountThread({ messages: [message(1, { teamTags: [ADA] })], total: 1, onSelectTeam });
    const tag = qa(m, 'team-chat-tag')[0] as HTMLButtonElement;
    tag.click();
    tag.click();
    expect(onSelectTeam).toHaveBeenNthCalledWith(1, { kind: 'teams', headRefs: ['head-ada'] });
    expect(onSelectTeam).toHaveBeenNthCalledWith(2, NO_TEAM_FILTER);
  });

  it('renders an unselected row tag at the 20-head cap as disabled with the limit as its title, and never navigates', async () => {
    const full = Array.from({ length: 20 }, (_, i) => `head-full${i}`);
    const onSelectTeam = vi.fn();
    const m = await mountThread({
      messages: [message(1, { teamTags: [{ headId: full[0], label: 'team.zero' }, ADA] }), message(2, { teamTags: [ADA] })],
      total: 2,
      filter: { kind: 'teams', headRefs: full },
      onSelectTeam,
    });
    const tags = qa(m, 'team-chat-tag');
    // Both rows carry the unselected head-ada plus row 1's already-selected
    // head-full0: at the cap the unselected tag is blocked (Gil N3: not
    // native-disabled — the button stays focusable and clickable so the
    // guard can ANNOUNCE the limit; a native disabled control is unreachable
    // for keyboard and screen-reader users) and its title names the limit
    // instead of promising an add; the selected one stays enabled (removal
    // is always allowed).
    expect(tags).toHaveLength(3);
    const blocked = tags.filter((el) => el.getAttribute('aria-disabled') === 'true');
    expect(blocked.map((el) => el.getAttribute('data-head'))).toEqual(['head-ada', 'head-ada']);
    for (const el of blocked) {
      expect(el.hasAttribute('disabled')).toBe(false);
      expect(el.getAttribute('title')).toBe('At most 20 teams can be selected.');
    }
    const enabled = tags.filter((el) => el.getAttribute('aria-disabled') !== 'true');
    expect(enabled.map((el) => el.getAttribute('data-head'))).toEqual(['head-full0']);
    expect(enabled[0].getAttribute('title')).toBe('Remove this team from the filter');
    // The blocked control explains itself through the live region instead of
    // navigating — the guard is the reachable path, not dead code.
    (blocked[0] as HTMLButtonElement).click();
    expect(onSelectTeam).not.toHaveBeenCalled();
    expect(q(m, 'team-chat-filter-status')?.textContent).toContain('At most 20 teams can be selected.');
  });

  it('focuses the added head\'s own chip, not the first chip, when several are selected', async () => {
    const props = reactiveProps<Record<string, unknown>>({
      messages: [message(1, { teamTags: [ADA] }), message(2, { teamTags: [BO] })],
      total: 2, filter: { kind: 'teams', headRefs: ['head-ada'] },
      onSelectTeam: (next: TeamChatFilter) => { props.filter = next; },
    });
    const m = await mountThread(props);
    document.body.append(m.target);
    (qa(m, 'team-chat-tag')[1] as HTMLButtonElement).click();
    await tick(4);
    expect(document.activeElement).toBe(chipFor(m, 'head-bo'));
    expect(document.activeElement).not.toBe(chipFor(m, 'head-ada'));
  });

  it('focuses the removed chip\'s neighbour on a middle-chip removal, and All messages when the last head goes', async () => {
    const props = reactiveProps<Record<string, unknown>>({
      messages: [message(1, { teamTags: [ADA] }), message(2, { teamTags: [BO] }), message(3, { teamTags: [CY] })],
      total: 3, filter: { kind: 'teams', headRefs: ['head-ada', 'head-bo', 'head-cy'] },
      onSelectTeam: (next: TeamChatFilter) => { props.filter = next; },
    });
    const m = await mountThread(props);
    document.body.append(m.target);
    chipFor(m, 'head-bo')!.click(); // middle chip out
    await tick(4);
    expect(document.activeElement).toBe(chipFor(m, 'head-cy'));
    chipFor(m, 'head-cy')!.click(); // now the last-but-one… focus its neighbour chain
    await tick(4);
    chipFor(m, 'head-ada')!.click(); // the last head: nothing remains
    await tick(4);
    const all = [...q(m, 'team-chat-filter')!.querySelectorAll('button')].find((b) => b.textContent?.includes('All messages'))!;
    expect(document.activeElement).toBe(all);
  });

  it('gives several unlabelled chips distinct accessible names built from their head refs', async () => {
    // Georgia's LOCAL P3 + the BLIND focus note: two sparse heads used to
    // render identical "Selected team" chips — same name, no identity.
    const m = await mountThread({
      messages: [message(1, { teamTags: [ADA] })], total: 1,
      filter: { kind: 'teams', headRefs: ['head-x1', 'head-y2'] },
      onSelectTeam: vi.fn(),
    });
    const chips = qa(m, 'team-chat-filter-active');
    expect(chips).toHaveLength(2);
    const names = chips.map((el) => el.getAttribute('aria-label') ?? '');
    expect(names[0]).toContain('head-x1');
    expect(names[1]).toContain('head-y2');
    expect(names[0]).not.toBe(names[1]);
    expect(chips[0].textContent).toContain('head-x1');
    expect(chips[1].textContent).toContain('head-y2');
  });

  it('announces the remaining set when a head leaves via its filter-bar chip (no clicked label exists)', async () => {
    const props = reactiveProps<Record<string, unknown>>({
      messages: [message(1, { teamTags: [ADA] }), message(2, { teamTags: [BO] })],
      total: 2, filter: { kind: 'teams', headRefs: ['head-ada', 'head-bo'] },
      onSelectTeam: (next: TeamChatFilter) => { props.filter = next; },
    });
    const m = await mountThread(props);
    document.body.append(m.target);
    chipFor(m, 'head-ada')!.click();
    await tick(4);
    expect(q(m, 'team-chat-filter-status')?.textContent).toContain('team.bo');
    expect(q(m, 'team-chat-filter-status')?.textContent).not.toContain('team.ada');
  });
});

describe('TeamChatThread team filter — optimistic pending set and reachable cap (round 3, Gil N1/N3/N4)', () => {
  const chipOf = (m: Mounted<Record<string, unknown>>, head: string) =>
    m.target.querySelector(`[data-testid="team-chat-filter-active"][data-head="${head}"]`) as HTMLButtonElement | null;
  const tagOf = (m: Mounted<Record<string, unknown>>, head: string) =>
    m.target.querySelector(`[data-testid="team-chat-tag"][data-head="${head}"]`) as HTMLButtonElement | null;
  const allButton = (m: Mounted<Record<string, unknown>>) =>
    [...m.target.querySelectorAll<HTMLButtonElement>('[data-testid="team-chat-filter"] button')]
      .find((b) => b.textContent?.includes('All messages'))!;
  const untaggedButton = (m: Mounted<Record<string, unknown>>) =>
    [...m.target.querySelectorAll<HTMLButtonElement>('[data-testid="team-chat-filter"] button')]
      .find((b) => b.textContent?.includes('No team tag recorded'))!;

  it('renders the PENDING set while a removal is in flight — the removed chip is gone, so a second click cannot re-add its head (N1)', async () => {
    // The parent never writes back: after the chip click the applied prop
    // still says {ada, bo}, but the view must show the requested {ada} —
    // what the user sees and what a click does have to agree.
    const onSelectTeam = vi.fn();
    const m = await mountThread({
      messages: [message(1, { teamTags: [ADA] }), message(2, { teamTags: [BO] })],
      total: 2, filter: { kind: 'teams', headRefs: ['head-ada', 'head-bo'] }, onSelectTeam,
    });
    chipOf(m, 'head-bo')!.click();
    expect(chipOf(m, 'head-bo')).toBeNull(); // gone from the pending view
    expect(chipOf(m, 'head-ada')).not.toBeNull();
    // The remaining chip is a pure REMOVE: even mid-request it can only
    // shrink the set, never re-add what was already removed.
    chipOf(m, 'head-ada')!.click();
    expect(onSelectTeam).toHaveBeenLastCalledWith(NO_TEAM_FILTER);
  });

  it('a pending-added head at the cap renders pressed and stays removable — pressed and blocked both judge the pending set (N1)', async () => {
    const nineteen = Array.from({ length: 19 }, (_, i) => `head-full${i}`);
    const X = { headId: 'head-x', label: 'team.x' };
    const Y = { headId: 'head-y', label: 'team.y' };
    const onSelectTeam = vi.fn();
    const m = await mountThread({
      messages: [message(1, { teamTags: [{ headId: nineteen[0], label: 'team.zero' }, X, Y] })],
      total: 1, filter: { kind: 'teams', headRefs: nineteen }, onSelectTeam,
    });
    (tagOf(m, 'head-x') as HTMLButtonElement).click(); // pending add — the 20th head, no write-back
    const added = tagOf(m, 'head-x')!;
    expect(added.getAttribute('aria-pressed')).toBe('true');
    expect(added.getAttribute('aria-disabled')).not.toBe('true'); // removable, never trapped
    expect(added.getAttribute('title')).toBe('Remove this team from the filter');
    const other = tagOf(m, 'head-y')!;
    expect(other.getAttribute('aria-pressed')).toBe('false');
    expect(other.getAttribute('aria-disabled')).toBe('true'); // 21st head: still blocked at the cap
  });

  it('a same-key choice while a request is pending is a no-op — no pointless navigation (N1)', async () => {
    const onSelectTeam = vi.fn();
    const m = await mountThread({
      messages: [message(1, { teamTags: [ADA] })], total: 1, onSelectTeam,
    });
    untaggedButton(m).click();
    expect(onSelectTeam).toHaveBeenCalledTimes(1);
    untaggedButton(m).click(); // same key as the pending request
    expect(onSelectTeam).toHaveBeenCalledTimes(1);
  });

  it('a bulk clear (All messages from several heads) focuses the pressed All control, not a chip neighbour (N4)', async () => {
    const props = reactiveProps<Record<string, unknown>>({
      messages: [message(1, { teamTags: [ADA] }), message(2, { teamTags: [BO] })],
      total: 2, filter: { kind: 'teams', headRefs: ['head-ada', 'head-bo'] },
      onSelectTeam: (next: TeamChatFilter) => { props.filter = next; },
    });
    const m = await mountThread(props);
    document.body.append(m.target);
    allButton(m).click();
    await tick(4);
    expect(document.activeElement).toBe(allButton(m));
    expect(q(m, 'team-chat-filter-status')?.textContent).toContain('All messages selected.');
  });

  it('removing the order-LAST head focuses its previous neighbour when no next chip exists (T1)', async () => {
    const CY = { headId: 'head-cy', label: 'team.cy' };
    const props = reactiveProps<Record<string, unknown>>({
      messages: [message(1, { teamTags: [ADA] }), message(2, { teamTags: [BO] }), message(3, { teamTags: [CY] })],
      total: 3, filter: { kind: 'teams', headRefs: ['head-ada', 'head-bo', 'head-cy'] },
      onSelectTeam: (next: TeamChatFilter) => { props.filter = next; },
    });
    const m = await mountThread(props);
    document.body.append(m.target);
    chipOf(m, 'head-cy')!.click();
    await tick(4);
    expect(document.activeElement).toBe(chipOf(m, 'head-bo'));
  });
});
