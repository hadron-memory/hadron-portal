/**
 * #855 — the team chat's URN slot, mounted.
 *
 * CLIENT lane: the thread builds its rows after mount, and what matters is the
 * rendered header of each message.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
import type { TeamChatMessage } from '$lib/types';
import TeamChatThread from './TeamChatThread.svelte';

const DARA = 'hrn:worker:acme.com:team:dara';
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const message = (seq: number, over: Partial<TeamChatMessage>): TeamChatMessage => ({
  nodeId: `m${seq}`,
  seq,
  body: `body ${seq}`,
  at: '2026-09-24T12:00:00.000Z',
  authorUserId: null,
  authorWorkerId: null,
  authorName: null,
  sessionId: null,
  replyToSeq: null,
  mentions: [],
  urn: null,
  teamTags: null,
  ...over,
});

async function mountThread(
  workerUrns: ReadonlyMap<string, string> | null,
  messages: TeamChatMessage[] = [
    message(1, { authorWorkerId: 'w1', authorName: 'Dara' }),
    message(2, { authorUserId: 'u1', authorName: 'holger' }),
  ],
) {
  setStubPage('https://example.test/app/apps/a1', { appId: 'a1' });
  const postForm = await superValidate(zod4(postTeamChatMessageSchema), { errors: false });
  const m = mountComponent(TeamChatThread as never, {
    messages,
    total: messages.length,
    postForm,
    workerUrns,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m;
}

/** The header row of message `seq`, found by its visible "#seq". */
function rowOf(target: HTMLElement, seq: number): HTMLElement {
  const seqSpan = Array.from(target.querySelectorAll('span.font-mono')).find((s) => s.textContent === `#${seq}`);
  if (!seqSpan) throw new Error(`message #${seq} not rendered`);
  return seqSpan.closest('.group') as HTMLElement;
}

describe('TeamChatThread — the URN slot (#855)', () => {
  it('shows a worker author\'s URN, and none for a human author', async () => {
    const { target } = await mountThread(new Map([['w1', DARA]]));
    const worker = rowOf(target, 1).querySelector('[data-testid="team-chat-urns"]');
    expect(worker).not.toBeNull();
    expect(worker!.textContent).toContain('dara');
    // A human's URN is not in this payload: no chip, not an empty one.
    expect(rowOf(target, 2).querySelector('[data-testid="team-chat-urns"]')).toBeNull();
  });

  it('renders no chip when the roster failed to load — absent, never empty', async () => {
    const { target } = await mountThread(null);
    // Positive control: the messages rendered.
    expect(rowOf(target, 1).textContent).toContain('Dara');
    expect(target.querySelector('[data-testid="team-chat-urns"]')).toBeNull();
  });

  it('is revealed by keyboard focus as well as hover, since its controls stay in the tab order', async () => {
    const { target } = await mountThread(new Map([['w1', DARA]]));
    const slot = rowOf(target, 1).querySelector('[data-testid="team-chat-urns"]')!;
    // jsdom applies no CSS, so the contract is the classes: hidden by default,
    // shown on hover AND on focus within the message row.
    expect(slot.className).toContain('opacity-0');
    expect(slot.className).toContain('group-hover:opacity-100');
    expect(slot.className).toContain('group-focus-within:opacity-100');
    // On a device that cannot hover, it is simply shown (@codex on #908).
    expect(slot.className).toContain('[@media(hover:none)]:opacity-100');
    expect(slot.className).toContain('[@media(hover:none)]:pointer-events-auto');
    // And it may SHRINK: on a narrow screen, where it is always shown, the chip
    // must wrap and truncate rather than widen the header past the thread
    // (measured at 375px before this: 383px of content in a 199px header).
    expect(slot.className).toContain('min-w-0');
    expect((slot.parentElement as HTMLElement).className).toMatch(/\bmin-w-0\b.*\bmax-w-full\b|\bmax-w-full\b.*\bmin-w-0\b/);
    // …and the reveal is scoped to THIS message's row.
    expect(rowOf(target, 1).classList.contains('group')).toBe(true);
    // The chip itself is a real link, reachable by Tab, to the URN resolver —
    // which redirects to the worker's profile.
    expect(slot.querySelector('a')!.getAttribute('href')).toBe(`/app/u/${DARA}`);
  });
});

describe('TeamChatThread — bounded scroll-back (#1536)', () => {
  it('keeps loading older 20-message pages when the initial page is too short to scroll', async () => {
    setStubPage('https://example.test/app/apps/a1', { appId: 'a1' });
    const postForm = await superValidate(zod4(postTeamChatMessageSchema), { errors: false });
    const onLoadOlder = vi.fn(async (beforeSeq: number) => ({
      items: Array.from({ length: 20 }, (_, i) => message(beforeSeq - 20 + i, {})),
      total: beforeSeq - 1, // cursor-scoped, never the full-thread count
    }));
    const m = mountComponent(TeamChatThread as never, {
      messages: Array.from({ length: 20 }, (_, i) => message(41 + i, {})),
      total: 60,
      postForm,
      onLoadOlder,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);

    const olderButton = () => Array.from(m.target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Load earlier messages'));
    expect(olderButton()).toBeDefined();
    olderButton()!.click();
    await vi.waitFor(() => expect(rowOf(m.target, 21)).not.toBeNull());
    expect(onLoadOlder).toHaveBeenNthCalledWith(1, 41);
    expect(olderButton()).toBeDefined();

    olderButton()!.click();
    await vi.waitFor(() => expect(rowOf(m.target, 1)).not.toBeNull());
    expect(onLoadOlder).toHaveBeenNthCalledWith(2, 21);
    expect(olderButton()).toBeUndefined();
    expect(m.target.textContent).toContain('Start of the conversation');
  });

  it('keeps scroll-back available when a concurrent post made the tail count one low', async () => {
    setStubPage('https://example.test/app/apps/a1', { appId: 'a1' });
    const postForm = await superValidate(zod4(postTeamChatMessageSchema), { errors: false });
    const onLoadOlder = vi.fn(async () => ({ items: [message(1, {})], total: 1 }));
    const m = mountComponent(TeamChatThread as never, {
      messages: Array.from({ length: 20 }, (_, i) => message(2 + i, {})),
      total: 20, // count happened before #21 was posted
      postForm,
      onLoadOlder,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);

    const button = Array.from(m.target.querySelectorAll('button')).find((el) => el.textContent?.includes('Load earlier messages'));
    expect(button).toBeDefined();
    button!.click();
    await vi.waitFor(() => expect(rowOf(m.target, 1)).not.toBeNull());
    expect(onLoadOlder).toHaveBeenCalledWith(2);
  });
});

describe('TeamChatThread — bounded refresh (#1536)', () => {
  it('advances a forward cursor through a burst without leaving a gap', async () => {
    setStubPage('https://example.test/app/apps/a1', { appId: 'a1' });
    const postForm = await superValidate(zod4(postTeamChatMessageSchema), { errors: false });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    vi.useFakeTimers();
    try {
      const onRefresh = vi.fn(async (sinceSeq?: number) => {
        if (sinceSeq === 20) return {
          items: Array.from({ length: 20 }, (_, i) => message(21 + i, {})), total: 25, loadFailed: false,
        };
        if (sinceSeq === 40) return {
          items: Array.from({ length: 5 }, (_, i) => message(41 + i, {})), total: 5, loadFailed: false,
        };
        throw new Error(`unexpected cursor ${sinceSeq}`);
      });
      const m = mountComponent(TeamChatThread as never, {
        messages: Array.from({ length: 20 }, (_, i) => message(1 + i, {})),
        total: 20,
        postForm,
        onRefresh,
        onLoadOlder: vi.fn(async () => ({ items: [], total: 0 })),
        pollMs: 100,
      } as never) as Mounted<Record<string, unknown>>;
      mounted.push(m);
      await tick(2);
      await vi.advanceTimersByTimeAsync(100);
      await tick(2);
      expect(onRefresh).toHaveBeenNthCalledWith(1, 20);
      expect(rowOf(m.target, 40)).not.toBeNull();
      expect(m.target.textContent).toContain('Loading newer messages…');
      expect(m.target.textContent).not.toContain('Load earlier messages');
      await vi.advanceTimersByTimeAsync(100);
      await tick(2);
      expect(onRefresh).toHaveBeenNthCalledWith(2, 40);
      expect(rowOf(m.target, 45)).not.toBeNull();
      expect(Array.from(m.target.querySelectorAll('span.font-mono')).filter((el) => /^#\d+$/.test(el.textContent ?? ''))).toHaveLength(45);
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(document, 'hidden');
    }
  });
});

describe('TeamChatThread — the message\'s own URN (#855, server#1209)', () => {
  const MSG1 = 'hrn:node:acme.com:team-shared:chats:team:messages:0001-k3x9';
  const MSG2 = 'hrn:node:acme.com:team-shared:chats:team:messages:0002-p7qa';
  const withUrns = () => [
    message(1, { authorWorkerId: 'w1', authorName: 'Dara', urn: MSG1, mentions: ['gil'] }),
    message(2, { authorUserId: 'u1', authorName: 'holger', urn: MSG2 }),
    message(3, { authorWorkerId: 'w1', authorName: 'Dara', urn: null }),
  ];
  const messageChip = (row: HTMLElement) => row.querySelector('[data-testid="team-chat-message-urn"]');
  const authorChip = (row: HTMLElement) => row.querySelector('[data-testid="team-chat-urns"] [data-testid="team-chat-author-urn"]');

  it('sits BELOW the message box, right-aligned, not in the header (Holger on #917)', async () => {
    const { target } = await mountThread(new Map([['w1', DARA]]), withUrns());
    const row = rowOf(target, 1);
    const chip = messageChip(row)!;
    // Not in the header's URN slot, which keeps only the author chip…
    expect(row.querySelector('[data-testid="team-chat-urns"] [data-testid="team-chat-message-urn"]')).toBeNull();
    // …but after the body's white box in document order, and pushed right.
    const box = row.querySelector(`#team-chat-msg-m1`)!;
    expect(box.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chip.className).toContain('ml-auto');
    // It shares the footer row with the mentions, which stay on the left.
    expect(chip.parentElement!.textContent).toContain('@gil');
    expect(chip.querySelector('a')!.getAttribute('href')).toBe(`/app/u/${MSG1}`);
  });

  it('is revealed like the author chip: hover, focus within the message, or always on touch', async () => {
    const { target } = await mountThread(new Map([['w1', DARA]]), withUrns());
    const chip = messageChip(rowOf(target, 1))!;
    expect(chip.className).toContain('opacity-0');
    expect(chip.className).toContain('group-hover:opacity-100');
    expect(chip.className).toContain('group-focus-within:opacity-100');
    expect(chip.className).toContain('[@media(hover:none)]:opacity-100');
    expect(chip.className).toContain('min-w-0');
  });

  it('keeps the worker author\'s chip in the header, each chip a link to the URN resolver', async () => {
    const { target } = await mountThread(new Map([['w1', DARA]]), withUrns());
    expect(authorChip(rowOf(target, 1))!.querySelector('a')!.getAttribute('href')).toBe(`/app/u/${DARA}`);
  });

  it('names each chip\'s copy buttons for what they copy (@codex on #917)', async () => {
    const { target } = await mountThread(new Map([['w1', DARA]]), withUrns());
    const row = rowOf(target, 1);
    const names = (el: Element | null) => [...(el?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-label'));
    expect(names(authorChip(row))).toEqual(['Copy author URN', 'Copy author URL']);
    expect(names(messageChip(row))).toEqual(['Copy message URN', 'Copy message URL']);
  });

  it('gives a HUMAN\'s message its chip too, with no header slot', async () => {
    const { target } = await mountThread(new Map([['w1', DARA]]), withUrns());
    const row = rowOf(target, 2);
    expect(messageChip(row)!.textContent).toContain('0002-p7qa');
    expect(row.querySelector('[data-testid="team-chat-urns"]')).toBeNull();
  });

  it('renders no message chip for a null URN — absent, never empty or guessed', async () => {
    const { target } = await mountThread(new Map([['w1', DARA]]), withUrns());
    const row = rowOf(target, 3);
    // Positive control: the author chip rendered.
    expect(authorChip(row)).not.toBeNull();
    expect(messageChip(row)).toBeNull();
  });

  it('still shows the message chip when the roster failed to load', async () => {
    const { target } = await mountThread(null, withUrns());
    expect(messageChip(rowOf(target, 1))).not.toBeNull();
    expect(rowOf(target, 1).querySelector('[data-testid="team-chat-urns"]')).toBeNull();
  });
});

describe('TeamChatThread — the avatar links to the author\'s profile (Holger on #917)', () => {
  const avatar = (row: HTMLElement) => row.querySelector<HTMLAnchorElement>('[data-testid="team-chat-avatar-link"]');

  it('links a worker\'s avatar to the worker\'s profile, and a person\'s to theirs — the name link\'s target', async () => {
    const { target } = await mountThread(new Map([['w1', DARA]]));
    for (const [seq, href] of [[1, '/app/workers/w1'], [2, '/app/user/u1']] as const) {
      const row = rowOf(target, seq);
      expect(avatar(row)!.getAttribute('href')).toBe(href);
      const nameLink = [...row.querySelectorAll('a')].find((a) => a !== avatar(row) && a.getAttribute('href') === href);
      expect(nameLink).toBeDefined();
    }
  });

  it('is out of the tab order, but never aria-hidden: a clicked link can take focus (@codex on #918)', async () => {
    const { target } = await mountThread(new Map([['w1', DARA]]));
    const worker = avatar(rowOf(target, 1))!;
    expect(worker.getAttribute('tabindex')).toBe('-1');
    expect(worker.hasAttribute('aria-hidden')).toBe(false);
    // So it carries its own accessible name, saying whose profile it opens.
    expect(worker.getAttribute('aria-label')).toBe('Open Dara’s worker profile');
    expect(avatar(rowOf(target, 2))!.getAttribute('aria-label')).toBe('Open holger’s profile');
  });

  it('is plain, not a link, for an author with no id to link with', async () => {
    const { target } = await mountThread(new Map(), [message(1, { authorName: 'someone' })]);
    expect(avatar(rowOf(target, 1))).toBeNull();
    // Positive control: the avatar itself rendered.
    expect(rowOf(target, 1).textContent).toContain('S');
  });
});

describe('TeamChatThread — the composer after a post (#957)', () => {
  type Msg = { type: 'success' | 'error'; text: string };
  /** A post form as the App action returns it: the posted values plus a message. */
  async function posted(body: string, msg: Msg, valid = true) {
    const f = await superValidate({ _kind: 'postTeamChatMessage', body }, zod4(postTeamChatMessageSchema));
    return { ...f, valid, message: msg };
  }
  async function mountComposer(form: unknown) {
    setStubPage('https://example.test/app/apps/a1', { appId: 'a1' });
    const postForm = await superValidate(zod4(postTeamChatMessageSchema), { errors: false });
    const m = mountComponent(TeamChatThread as never, {
      messages: [message(1, { authorUserId: 'u1', authorName: 'holger' })],
      total: 1,
      postForm,
      form,
      workerUrns: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    return m.target;
  }
  const composer = (t: HTMLElement) => t.querySelector<HTMLTextAreaElement>('#team-chat-body')!;

  it('remounting while a SUCCESSFUL post is still the page\'s action data leaves the composer empty', async () => {
    // Chip's repro step 2: post C, switch Settings -> Chats. The action data
    // still carries C; it must not come back into the composer.
    const t = await mountComposer({ form: await posted('message C', { type: 'success', text: 'Posted to the team chat.' }) });
    expect(composer(t).value).toBe('');
  });

  it('a FAILED post\'s draft is kept, whether refused by validation or by the server', async () => {
    const server = await mountComposer({ form: await posted('draft D', { type: 'error', text: 'Failed to post.' }) });
    expect(composer(server).value).toBe('draft D');
    const invalid = await mountComposer({ form: await posted('draft E', { type: 'error', text: 'x' }, false) });
    expect(composer(invalid).value).toBe('draft E');
  });

  it('a success after a kept draft empties the composer, and a later reset never brings the draft back', async () => {
    // The sibling of #957: seeded from a failed draft, `resetForm` alone would
    // reset TO that draft after the next successful post.
    const t = await mountComposer({ form: await posted('draft D', { type: 'error', text: 'Failed to post.' }) });
    expect(composer(t).value).toBe('draft D'); // positive control: the seed path ran
    const form = composer(t).closest('form')!;
    const ok = await posted('draft D', { type: 'success', text: 'Posted to the team chat.' });
    const { cancelled } = await submitEnhancedWithResult(form, { type: 'success', status: 200, data: { form: ok } });
    expect(cancelled).toBe(false);
    await tick(4);
    expect(composer(t).value).toBe('');

    // A second successful post resets to the re-based (empty) state too.
    composer(t).value = 'message F';
    composer(t).dispatchEvent(new Event('input', { bubbles: true }));
    await tick(2);
    const ok2 = await posted('message F', { type: 'success', text: 'Posted to the team chat.' });
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: { form: ok2 } });
    await tick(4);
    expect(composer(t).value).toBe('');
  });
});

