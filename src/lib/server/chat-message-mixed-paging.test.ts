import { expect, it, vi } from 'vitest';
import { loadChatMessages } from './team-chat';
import type { MemoryNode } from '$lib/types';

// Gate6557271549 says to return the exact gap if the existing client
// reorder/trim cannot preserve mixed history. Provider order copied from
// named candidate ac3b588 src/lib/retrieval/postgres.ts:84,98:
// seq ASC NULLS LAST, loc ASC. No invented mixed-order policy.
it('preserves every mixed message once across the existing seq-page boundaries', async () => {
  const root = 'chats:standup';
  const rows = [
    ...[1, 2, 3].map(seq => ({ id: `platform-${seq}`, nodeType: 'chat-message', seq, loc: `${root}:messages:00${seq}-synthetic` })),
    ...[1, 2].map(i => ({ id: `legacy-${i}`, nodeType: 'message', seq: null, loc: `${root}:messages:20261101T00000${i}Z-synthetic` })),
  ].map(n => ({ ...n, name: 'Synthetic', content: n.id, createdAt: '2026-11-01T00:00:00Z' } as MemoryNode));
  const request = vi.fn(async (_doc: string, vars: { offset: number; limit: number }) => ({
    // A current union-capable provider without #2836 returns both from this
    // unqualified read too. This isolates the pre-existing client paging
    // algorithm from any not-yet-authored nodeTypes change.
    findNodes: { total: rows.length, hits: rows.slice(vars.offset, vars.offset + vars.limit).map(node => ({ node })) },
  }));
  let before: number | undefined;
  let collected: string[] = [];
  const pages: Array<{ offset: number; ids: string[]; hasOlder: boolean }> = [];
  for (let i = 0; i < 10; i++) {
    const page = await loadChatMessages({ request } as never, 'synthetic-memory', root, { limit: 2, sort: 'seq', before });
    const ids = page.messages.map(m => m.id);
    pages.push({ offset: page.offset, ids, hasOlder: page.hasOlder });
    collected = [...ids, ...collected];
    if (!page.hasOlder) break;
    expect(page.offset).toBeLessThan(before ?? Infinity);
    before = page.offset;
  }
  expect({ pages, complete: [...new Set(collected)].sort(), count: collected.length }, JSON.stringify({ pages, collected, requests: request.mock.calls.map(([, vars]) => vars) })).toEqual({
    pages: [
      { offset: 3, ids: ['legacy-1', 'legacy-2'], hasOlder: true },
      { offset: 1, ids: ['platform-2', 'platform-3'], hasOlder: true },
      { offset: 0, ids: ['platform-1'], hasOlder: false },
    ], complete: rows.map(n => n.id).sort(), count: rows.length,
  });
});
