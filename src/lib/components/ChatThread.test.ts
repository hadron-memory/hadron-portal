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

import ChatThread from './ChatThread.svelte';

function renderThread(memoryUrn: string | null) {
  return render(ChatThread, {
    props: {
      messages: [
        {
          id: 'msg-pk',
          author: 'holger',
          content: 'hello team',
          createdAt: '2026-08-14T09:00:00Z',
          nodeData: { loc: 'chats:team:messages:2026-08-14T090000Z-holger' },
        },
      ],
      basePath: '/app/memories/mem-1',
      memoryUrn,
      sendForm: { data: { _kind: 'sendChatMessage', content: '' } } as never,
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
