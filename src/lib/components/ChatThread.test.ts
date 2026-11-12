import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

// superforms' CLIENT entrypoint reaches for SvelteKit's ambient `$app/*`
// modules, which only exist inside a SvelteKit build. These tests are about
// the rendered thread markup, not form plumbing, so the client half is stubbed
// with the stores the template reads.
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

import ChatThread, { type ChatThreadMessage } from './ChatThread.svelte';

function renderThread(memoryUrn: string | null) {
  return renderThreadWith({ memoryUrn });
}

/** portal#1525: the full render, with per-test overrides over the same base. */
function renderThreadWith(over: Record<string, unknown> = {}) {
  const { messages: overMessages, ...rest } = over;
  return render(ChatThread, {
    props: {
      messages: (overMessages as ChatThreadMessage[] | undefined) ?? [
        {
          id: 'msg-pk',
          author: 'holger',
          content: 'hello team',
          createdAt: '2026-08-14T09:00:00Z',
          nodeData: { loc: 'chats:team:messages:2026-08-14T090000Z-holger' },
        },
      ],
      basePath: '/app/memories/mem-1',
      memoryUrn: null,
      sendForm: { data: { _kind: 'sendChatMessage', content: '' } } as never,
      ...rest,
    },
  }).body;
}

describe('ChatThread — message URN chip', () => {
  it('composes a grammar-v2 node URN from the memory URN and the message loc', () => {
    const body = renderThread('hrn:mem:acme.com:notes');

    expect(body).toContain('hrn:node:acme.com:notes:chats:team:messages:');
    // The v1 `::` concatenation this replaced produced a memory-typed address
    // that never identified the message.
    expect(body).not.toContain('hrn:mem:acme.com:notes::');
  });

  it('renders the message without a chip when the memory URN is unknown', () => {
    const body = renderThread(null);

    // The bubble body itself is deliberately empty under SSR (invariant P4:
    // DOMPurify can't run without a DOM, so the {@html} sink stays unfilled).
    expect(body).toContain('holger');
    expect(body).not.toContain('Go to message node');
    expect(body).not.toContain('hrn:');
  });
});

describe('ChatThread — per-message seq (portal#1525)', () => {
  // The team-Channel full-screen view is the one surface that shows the
  // server's seq. Everything else that shares this component — the node page's
  // inline Chat tab, agent chats — must stay unchanged, so the renderer is
  // opt-in and the seq is the SERVER's field, never a client-side count
  // (Vera's FIT on #1525: seq has gaps by design; it is a watermark, not an index).
  const withSeq = [
    { id: 'm-0', author: 'ada', content: 'first', createdAt: '2026-11-01T07:00:00Z', seq: 0, nodeData: { loc: 'chats:team:messages:000-ada' } },
    { id: 'm-7', author: 'iris', content: 'later', createdAt: '2026-11-01T07:01:00Z', seq: 7, nodeData: { loc: 'chats:team:messages:007-iris' } },
  ];

  it('showSeq renders the server seq per message, including 0', () => {
    const body = renderThreadWith({ messages: withSeq, showSeq: true });

    // `#0` is load-bearing: a renderer that treats 0 as "no seq" would hide
    // the first message a thread ever got.
    expect(body).toContain('#0');
    expect(body).toContain('#7');
  });

  it('showSeq invents nothing for a message with null seq', () => {
    const body = renderThreadWith({
      messages: [
        { id: 'm-null', author: 'ada', content: 'legacy', createdAt: '2026-11-01T07:00:00Z', seq: null, nodeData: { loc: 'team-chat:messages:001-ada' } },
      ],
      showSeq: true,
    });

    // The bubble body is empty under SSR (invariant P4), so the author is
    // the rendered proof the message is there.
    expect(body).toContain('ada');
    expect(body).not.toContain('#');
  });

  it('without showSeq, a message carrying a seq renders none (other views unchanged)', () => {
    const body = renderThreadWith({ messages: withSeq });

    expect(body).toContain('ada');
    expect(body).toContain('iris');
    expect(body).not.toContain('#0');
    expect(body).not.toContain('#7');
  });
});
