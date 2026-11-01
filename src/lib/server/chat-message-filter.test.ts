import { describe, expect, it, vi } from 'vitest';
import { loadChatMessages } from './team-chat';
import { NODES_BY_LOC_PREFIX_QUERY } from './queries';
import type { MemoryNode } from '$lib/types';

const root = 'chats:fixture';
const prefix = `${root}:messages:`;
function row(seq: number, nodeType = 'chat-message', nested = false): MemoryNode {
  return { id: `${nodeType}-${seq}-${nested}`, loc: `${prefix}${String(seq).padStart(3, '0')}-fixture${nested ? ':attachment' : ''}`,
    nodeType, seq, name: 'Synthetic', content: `message ${seq}`, createdAt: '2026-11-01T00:00:00Z' } as MemoryNode;
}
// Candidate #2836 semantics: count and hits BOTH use the explicit type when
// supplied; otherwise platform messages are excluded before pagination.
function provider(rows: MemoryNode[]) {
  return { request: vi.fn(async (_doc: string, vars: Record<string, any>) => {
    const filtered = rows.filter(n => vars.nodeType ? n.nodeType === vars.nodeType : n.nodeType !== 'chat-message')
      .sort((a, b) => vars.sort === 'loc' ? a.loc.localeCompare(b.loc) : (a.seq ?? 0) - (b.seq ?? 0));
    return { findNodes: { total: filtered.length, hits: filtered.slice(vars.offset, vars.offset + vars.limit).map(node => ({ node })) } };
  }) };
}

describe('portal#1569 explicit transcript domain', () => {
  it('the actual query uses an optional nodeType in the server filter', () => {
    expect(NODES_BY_LOC_PREFIX_QUERY).toMatch(/\$nodeType:\s*String\b/);
    expect(NODES_BY_LOC_PREFIX_QUERY).toMatch(/nodeType:\s*\$nodeType/);
  });
  it('qualifies BOTH count/initial and corrective tail reads', async () => {
    const c = provider(Array.from({ length: 220 }, (_, i) => row(i + 980)));
    const page = await loadChatMessages(c as never, 'mem', root, { messageNodeType: 'chat-message' });
    expect(page.messages).toHaveLength(100);
    expect(page.messages.at(-1)?.seq).toBe(1199);
    expect(page.total).toBe(220);
    expect(c.request).toHaveBeenCalledTimes(2);
    for (const [doc, vars] of c.request.mock.calls) {
      expect(doc).toBe(NODES_BY_LOC_PREFIX_QUERY);
      expect(vars.nodeType).toBe('chat-message');
    }
  });

  it('tail/before/older windows give every direct message once, past seq 999, in the filtered count domain', async () => {
    const direct = Array.from({ length: 237 }, (_, i) => row(i + 980));
    const offroad = direct.filter((_, i) => i % 8 === 0).flatMap(n => [row(n.seq!, 'record'), row(n.seq!, 'chat-message', true)]);
    const c = provider([...direct, ...offroad]);
    let before: number | undefined;
    let all: string[] = [];
    for (let pages = 0; pages < 20; pages++) {
      const page = await loadChatMessages(c as never, 'mem', root, { limit: 37, before, messageNodeType: 'chat-message' });
      expect(page.total).toBe(direct.length + offroad.length / 2);
      all = [...page.messages.map(m => m.id), ...all];
      if (!page.hasOlder) break;
      expect(page.offset).toBeLessThan(before ?? Infinity);
      before = page.offset;
    }
    expect(all).toEqual(direct.map(n => n.id));
    expect(new Set(all).size).toBe(direct.length);
    for (const [, vars] of c.request.mock.calls) expect(vars.nodeType).toBe('chat-message');
  });

  it('legacy pages retain loc order and omit nodeType entirely, including corrective and before reads', async () => {
    const rows = Array.from({ length: 83 }, (_, i) => row(i + 1, 'message'));
    const c = provider(rows);
    let before: number | undefined;
    let all: string[] = [];
    for (let pages = 0; pages < 10; pages++) {
      const page = await loadChatMessages(c as never, 'mem', root, { sort: 'loc', limit: 20, before });
      all = [...page.messages.map(m => m.id), ...all];
      if (!page.hasOlder) break;
      before = page.offset;
    }
    expect(all).toEqual(rows.map(n => n.id));
    for (const [, vars] of c.request.mock.calls) {
      expect(vars).not.toHaveProperty('nodeType');
      expect(vars.sort).toBe('loc');
    }
  });
});
