/**
 * #855 — the team chat's URN slot, mounted.
 *
 * CLIENT lane: the thread builds its rows after mount, and what matters is the
 * rendered header of each message.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
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
  ...over,
});

async function mountThread(workerUrns: ReadonlyMap<string, string> | null) {
  setStubPage('https://example.test/app/apps/a1', { appId: 'a1' });
  const postForm = await superValidate(zod4(postTeamChatMessageSchema), { errors: false });
  const m = mountComponent(TeamChatThread as never, {
    messages: [
      message(1, { authorWorkerId: 'w1', authorName: 'Dara' }),
      message(2, { authorUserId: 'u1', authorName: 'holger' }),
    ],
    total: 2,
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
