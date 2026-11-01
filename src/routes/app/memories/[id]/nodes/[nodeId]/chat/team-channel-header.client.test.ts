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

    // The server's seq per message, 0 included.
    expect(target.textContent).toContain('#0');
    expect(target.textContent).toContain('#7');

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
    expect(target.textContent).not.toContain('#0');
    expect(target.textContent).not.toContain('#7');
  });
});
