/**
 * portal#1525 — the full-screen chat header, branched on whether the node is
 * the App's team CHANNEL.
 *
 * A team channel (`chatPostTarget` platform: nodeType `chat` + the canonical
 * team loc + an App) is a Channel (Holger's portal#1482 ruling): icon-only
 * collapse, the "<App> - Team Channel" caption, the server seq per message,
 * and none of the node-detail furniture. An agent/other chat keeps today's
 * wording and controls verbatim — the same route serves both, so the branch
 * is the whole change.
 *
 * Client lane because the page imports `$app/navigation`, which only the
 * client project aliases (vitest.config.ts, #668).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';

// Markup test, not a form test: the client superform entrypoint validates its
// SuperValidated shape at mount (checkForNestedData) and a hand-built loader
// fixture can't satisfy it. Stubbed exactly as ChatThread.test.ts stubs it —
// the stores the template reads, nothing more.
vi.mock('sveltekit-superforms', () => ({
  superForm: (initial: { data: unknown }) => ({
    form: writable(initial.data),
    errors: writable({}),
    message: writable(null),
    submitting: writable(false),
    enhance: () => ({ destroy() {} }),
  }),
}));
vi.mock('sveltekit-superforms/adapters', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  zod4Client: () => ({}),
}));
import { writable } from 'svelte/store';

import Page from './+page.svelte';

const GRAPH = { id: 'mem-1', name: 'Acme Notes', urn: 'hrn:mem:acme.com:notes' };
const APP = { id: 'app-1', name: 'Atlas', urn: 'hrn:app:acme.com:atlas' };
const BASE = '/app/memories/mem-1';

const MESSAGES = [
  { id: 'm-0', author: 'ada', content: 'first post', createdAt: '2026-11-01T07:00:00Z', seq: 0, nodeData: { loc: 'chats:team:messages:000-ada' } },
  { id: 'm-7', author: 'iris', content: 'a reply', createdAt: '2026-11-01T07:01:00Z', seq: 7, nodeData: { loc: 'chats:team:messages:007-iris' } },
];

/** Loader-shaped page data; `over` carries the branch and its fixtures. */
function data(over: Record<string, unknown> = {}) {
  return {
    node: { id: 'chat-pk', name: 'Team chat', loc: 'chats:team', memoryId: 'mem-1' },
    fullUrn: 'hrn:node:acme.com:notes:chats:team',
    ancestors: [],
    messages: MESSAGES,
    hasOlder: false,
    chatOffset: 0,
    chatApp: APP,
    canPost: true,
    form: { data: { _kind: 'sendChatMessage', content: '' }, errors: {} },
    graph: GRAPH,
    org: { id: 'org-1' },
    ...over,
  };
}

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

function mountPage(pageData: Record<string, unknown>) {
  const m = mountComponent(Page as never, { data: pageData, form: null } as never);
  mounted.push(m);
  return m.target;
}

describe('full-screen chat header — team channel vs agent chat (portal#1525)', () => {
  it('a team channel captions the view, collapses by icon, shows seq, drops the node-detail furniture', () => {
    const target = mountPage(data({ isTeamChannel: true }));

    // Caption "<App name> - Team Channel".
    expect(target.textContent).toContain('Atlas - Team Channel');

    // Icon-only collapse, back to the node page's INLINE view — the Chat tab
    // it was opened from, not the Content tab the details link targets.
    const collapse = target.querySelector<HTMLAnchorElement>('a[aria-label="Collapse to inline view"]');
    expect(collapse).not.toBeNull();
    expect(collapse!.getAttribute('href')).toBe(`${BASE}/nodes/chat-pk?tab=chat`);

    // The server's seq per message, 0 included. Asserted on the seq element,
    // not a textContent scan for '#0' — ids and href fragments contain '#'
    // too, so the old form could pass (or fail) for the wrong reason.
    const seqs = [...target.querySelectorAll<HTMLElement>('[data-seq]')].map((el) => el.dataset.seq);
    expect(seqs).toEqual(['0', '7']);

    // Removed on this surface only: the details link and the App line (label
    // + URN chip — the chip's visible text is the URN's bare value, the scheme
    // lives in a sibling badge). The App is still named — by the caption.
    expect(target.textContent).not.toContain('View node details');
    expect(target.textContent).not.toContain('acme.com:atlas');
    expect(target.querySelector('a[href="/app/apps/app-1"]')).toBeNull();
  });

  it('a team channel with an undisclosed App name captions safely, without an empty name', () => {
    const target = mountPage(data({ isTeamChannel: true, chatApp: null }));

    expect(target.textContent).toContain('Team Channel');
    expect(target.textContent).not.toContain(' - Team Channel');
  });

  it('an agent chat is unchanged: details link and App line stay, no caption, no collapse, no seq', () => {
    const target = mountPage(data({
      isTeamChannel: false,
      node: { id: 'chat-pk', name: 'Design review', loc: 'chats:design-review', memoryId: 'mem-1' },
    }));

    const details = target.querySelector<HTMLAnchorElement>('a[href="/app/memories/mem-1/nodes/chat-pk?tab=content"]');
    expect(details).not.toBeNull();
    expect(details!.textContent).toContain('View node details');

    // #489 part 4: the App reference survives the hop — on THIS surface it
    // stays a name + URN line.
    expect(target.textContent).toContain('Atlas');
    expect(target.textContent).toContain('acme.com:atlas');
    expect(target.querySelector('a[href="/app/apps/app-1"]')).not.toBeNull();

    // No Channel renaming, no icon collapse, no seq rendering.
    expect(target.textContent).not.toContain('Team Channel');
    expect(target.querySelector('a[aria-label="Collapse to inline view"]')).toBeNull();
    expect(target.querySelectorAll('[data-seq]')).toHaveLength(0);
  });

  // portal#1525: the page guards with `data?.isTeamChannel === true`, so a
  // payload WITHOUT the key (a stale serialization reaching a hydrated
  // client, a loader edit that drops it) must fall back to the agent-chat
  // branch, never to the Channel one. Pins the fallback the guard's comment
  // claims — silent classic rendering, not a crash and not Channel furniture.
  it('a payload missing isTeamChannel entirely falls back to the agent-chat branch', () => {
    const payload: Record<string, unknown> = data({
      node: { id: 'chat-pk', name: 'Team chat', loc: 'chats:team', memoryId: 'mem-1' },
    });
    const { isTeamChannel: _omit, ...rest } = payload;
    const target = mountPage(rest);

    expect(target.querySelector('a[aria-label="Collapse to inline view"]')).toBeNull();
    expect(target.textContent).not.toContain('Team Channel');
    expect(target.querySelector<HTMLAnchorElement>('a[href="/app/memories/mem-1/nodes/chat-pk?tab=content"]')).not.toBeNull();
  });
});

// portal#1525 fix head (Uma's UX P2): at 390px the header row pushed Reload
// and Collapse outside the viewport — the row never wrapped and the left
// block never shrank, because an unbreakable URN chip set its min-content
// width and nothing below it could recover. jsdom has no layout engine, so
// this lane pins the STRUCTURE that makes 390px work (the row wraps; the
// text block may shrink below its content so the chip's own truncation can
// engage; the button group may not); the geometry itself is asserted in the
// author browser run (document overflow == 0, Collapse box inside the
// viewport) on the same head.
describe('full-screen chat header — 390px structure (portal#1525 UX P2)', () => {
  function headerRow(target: HTMLElement) {
    // The row under the breadcrumb: the one flex container holding both the
    // title block and the Reload/Collapse group.
    const h1 = target.querySelector('h1');
    return h1?.parentElement?.parentElement ?? null;
  }

  it('the header row wraps instead of forcing the page wide', () => {
    const target = mountPage(data({ isTeamChannel: true }));
    const row = headerRow(target);

    expect(row).not.toBeNull();
    expect(row!.classList.contains('flex')).toBe(true);
    expect(row!.classList.contains('flex-wrap')).toBe(true);
  });

  it('the title block may shrink below its content, so the URN chip can truncate', () => {
    const target = mountPage(data({ isTeamChannel: true }));
    const h1 = target.querySelector('h1');

    // `min-w-0` on the chip's flex ancestor is what lets the chip's own
    // internal `min-w-0 truncate` engage; without it the block's min-content
    // width is the full URN and the row overflows at 390px.
    expect(h1?.parentElement?.classList.contains('min-w-0')).toBe(true);
    // A long single-token node name must wrap, not push the row wide.
    expect(h1?.classList.contains('break-words')).toBe(true);
  });

  it('the Reload/Collapse group keeps its size and never gets crushed', () => {
    const target = mountPage(data({ isTeamChannel: true }));
    const collapse = target.querySelector<HTMLAnchorElement>('a[aria-label="Collapse to inline view"]');

    const group = collapse?.parentElement;
    expect(group).not.toBeUndefined();
    expect(group!.classList.contains('shrink-0')).toBe(true);
  });
});
