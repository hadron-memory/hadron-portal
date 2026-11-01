import { describe, expect, it, vi } from 'vitest';
import { loadChatMessages } from './team-chat';
import { APP_CHAT_ROOTS_QUERY, NODES_BY_LOC_PREFIX_QUERY } from './queries';
import { Kind, parse, print } from 'graphql';
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
    if (Array.isArray(vars.nodeTypes) && vars.nodeTypes.length === 0) throw new Error('BAD_USER_INPUT empty nodeTypes');
    const filtered = rows.filter(n => vars.nodeTypes ? vars.nodeTypes.includes(n.nodeType) : vars.nodeType ? n.nodeType === vars.nodeType : n.nodeType !== 'chat-message')
      .sort((a, b) => vars.sort === 'loc' ? a.loc.localeCompare(b.loc) :
        a.seq == null ? (b.seq == null ? a.loc.localeCompare(b.loc) : 1) :
        b.seq == null ? -1 : a.seq - b.seq || a.loc.localeCompare(b.loc));
    return { findNodes: { total: filtered.length, hits: filtered.slice(vars.offset, vars.offset + vars.limit).map(node => ({ node })) } };
  }) };
}

describe('portal#1569 explicit transcript domain', () => {
  it('the actual query uses an optional list and App discovery selects the root type', () => {
    const operation = parse(NODES_BY_LOC_PREFIX_QUERY).definitions.find(d => d.kind === Kind.OPERATION_DEFINITION);
    if (!operation || operation.kind !== Kind.OPERATION_DEFINITION) throw new Error('missing operation');
    const variable = operation.variableDefinitions?.find(v => v.variable.name.value === 'nodeTypes');
    expect(variable && print(variable.type)).toBe('[String!]');
    const query = operation.selectionSet.selections.find(f => f.kind === Kind.FIELD && f.name.value === 'findNodes');
    if (!query || query.kind !== Kind.FIELD) throw new Error('missing findNodes');
    const filter = query.arguments?.find(a => a.name.value === 'filter')?.value;
    if (!filter || filter.kind !== Kind.OBJECT) throw new Error('missing filter');
    expect(filter.fields.find(f => f.name.value === 'nodeTypes')?.value).toMatchObject({ kind: Kind.VARIABLE, name: { value: 'nodeTypes' } });
    expect(filter.fields.some(f => f.name.value === 'nodeType')).toBe(false);
    const appOperation = parse(APP_CHAT_ROOTS_QUERY).definitions.find(d => d.kind === Kind.OPERATION_DEFINITION);
    if (!appOperation || appOperation.kind !== Kind.OPERATION_DEFINITION) throw new Error('missing App operation');
    const appNodes = appOperation.selectionSet.selections.find(f => f.kind === Kind.FIELD && f.name.value === 'appNodes');
    if (!appNodes || appNodes.kind !== Kind.FIELD) throw new Error('missing appNodes');
    expect(appNodes.selectionSet?.selections.some(f => f.kind === Kind.FIELD && f.name.value === 'nodeType')).toBe(true);
  });
  it('qualifies BOTH count/initial and corrective tail reads', async () => {
    const c = provider(Array.from({ length: 220 }, (_, i) => row(i + 980)));
    const page = await loadChatMessages(c as never, 'mem', root, { messageNodeTypes: ['chat-message', 'message'] } as never);
    expect(page.messages).toHaveLength(100);
    expect(page.messages.at(-1)?.seq).toBe(1199);
    expect(page.total).toBe(220);
    expect(c.request).toHaveBeenCalledTimes(2);
    for (const [doc, vars] of c.request.mock.calls) {
      expect(doc).toBe(NODES_BY_LOC_PREFIX_QUERY);
      expect(vars.nodeTypes).toEqual(['chat-message', 'message']);
    }
  });

  it('tail/before/older windows give every direct message once, past seq 999, in the filtered count domain', async () => {
    const direct = Array.from({ length: 237 }, (_, i) => row(i + 980));
    const offroad = direct.filter((_, i) => i % 8 === 0).flatMap(n => [row(n.seq!, 'record'), row(n.seq!, 'chat-message', true)]);
    const c = provider([...direct, ...offroad]);
    let before: number | undefined;
    let all: string[] = [];
    for (let pages = 0; pages < 20; pages++) {
      const page = await loadChatMessages(c as never, 'mem', root, { limit: 37, before, messageNodeTypes: ['chat-message', 'message'] } as never);
      expect(page.total).toBe(direct.length + offroad.length / 2);
      all = [...page.messages.map(m => m.id), ...all];
      if (!page.hasOlder) break;
      expect(page.offset).toBeLessThan(before ?? Infinity);
      before = page.offset;
    }
    expect(all).toEqual(direct.map(n => n.id));
    expect(new Set(all).size).toBe(direct.length);
    for (const [, vars] of c.request.mock.calls) expect(vars.nodeTypes).toEqual(['chat-message', 'message']);
  });

  it('preserves mixed historical rows in provider order across every page', async () => {
    const platform = Array.from({ length: 131 }, (_, i) => row(i + 980));
    const legacy = Array.from({ length: 57 }, (_, i) => ({ ...row(i, 'message'), seq: null,
      loc: `${prefix}20261101T${String(i).padStart(6, '0')}Z-synthetic` } as MemoryNode));
    const nested = { ...legacy[0], id: 'nested-message', loc: `${legacy[0].loc}:attachment` };
    const c = provider([...platform, ...legacy, nested, row(1002, 'record'), row(1001, 'chat-message', true)]);
    let before: number | undefined;
    let all: string[] = [];
    for (let pages = 0; pages < 30; pages++) {
      const page = await loadChatMessages(c as never, 'mem', root, { limit: 19, before, messageNodeTypes: ['chat-message', 'message'] } as never);
      expect(page.total).toBe(platform.length + legacy.length + 2);
      all = [...page.messages.map(m => m.id), ...all];
      if (!page.hasOlder) break;
      expect(page.offset).toBeLessThan(before ?? Infinity);
      before = page.offset;
    }
    expect(all).toEqual([...platform, ...legacy].map(n => n.id));
    expect(new Set(all).size).toBe(platform.length + legacy.length);
    for (const [, vars] of c.request.mock.calls) expect(vars.nodeTypes).toEqual(['chat-message', 'message']);
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
      expect(vars).not.toHaveProperty('nodeTypes');
      expect(vars.sort).toBe('loc');
    }
  });
});
