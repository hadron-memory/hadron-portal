/**
 * portal#1576 — the node picker's endpoint. The read goes out with the
 * VIEWER's token only; a memory the viewer can't read returns the server's
 * answer passed through (an intersected empty, never a portal error); a
 * failed read is distinguishable from an empty one; paging stops on a short
 * page and never shows or relies on a total (a lexical findNodes returns
 * total: null — hadron-server#3113).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
const gqlClient = vi.fn(() => ({ request: mockRequest }));
vi.mock('$lib/server/api', () => ({ gqlClient: (...args: unknown[]) => gqlClient(...(args as [])) }));

import { GET } from './+server';
import { NODE_CHOICES_QUERY } from '$lib/server/node-choices';
import { Kind, parse } from 'graphql';
import type { FieldNode, OperationDefinitionNode, SelectionSetNode } from 'graphql';

// The selection set is asserted through the AST, never as text: a raw
// `.toContain`/`.not.toContain` over the document reads its own comments as
// happily as its fields (hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail).
const fieldsOf = (set: SelectionSetNode) =>
  set.selections.filter((s): s is FieldNode => s.kind === Kind.FIELD).map((f) => f.name.value);
const field = (set: SelectionSetNode, name: string) =>
  set.selections.find((s): s is FieldNode => s.kind === Kind.FIELD && s.name.value === name);

const op = parse(NODE_CHOICES_QUERY).definitions.find(
  (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
)!;
const findNodes = field(op.selectionSet, 'findNodes')!;
const FINDNODES_FIELDS = fieldsOf(findNodes.selectionSet!);
const HITS_FIELD_SET = field(findNodes.selectionSet!, 'hits')!.selectionSet!;
const NODE_FIELDS = fieldsOf(field(HITS_FIELD_SET, 'node')!.selectionSet!);

beforeEach(() => {
  mockRequest.mockReset();
  gqlClient.mockClear();
});

function ev(memoryId: string, token: string | null, search: string) {
  return {
    params: { id: memoryId },
    locals: { token },
    url: new URL(`http://local/app/memories/${memoryId}/nodes/choices${search}`),
  } as unknown as Parameters<typeof GET>[0];
}

const hit = (i: number) => ({ node: { id: `n${i}`, name: `Node ${i}`, loc: `loc:${i}`, urn: `hrn:node:example.com:kb:loc:${i}` } });
const hits = (n: number) => Array.from({ length: n }, (_, i) => hit(i));

describe('/app/memories/[id]/nodes/choices (#1576)', () => {
  it('reads with the viewer token only and asks for one lexical page, never a total', async () => {
    mockRequest.mockResolvedValueOnce({ findNodes: { hits: hits(1) } });
    const res = await GET(ev('m1', 'viewer-token', '?query=kb&offset=0'));
    expect(gqlClient).toHaveBeenCalledWith('viewer-token');
    expect(mockRequest.mock.calls[0][0]).toBe(NODE_CHOICES_QUERY);
    expect(mockRequest.mock.calls[0][1]).toEqual({ memoryId: 'm1', query: 'kb', limit: 20, offset: 0 });
    // #1576: the picker never asks for a total (a lexical findNodes returns
    // `total: null`, hadron-server#3113) — the selection is hits → node only,
    // and the node's SERVER-composed urn is among what it asks for.
    expect(FINDNODES_FIELDS).toEqual(['hits']);
    expect(fieldsOf(HITS_FIELD_SET)).toEqual(['node']);
    expect(NODE_FIELDS).toEqual(['id', 'name', 'loc', 'urn']);
    const body = await res.json();
    expect(body).toEqual({ kind: 'ok', value: { items: [{ id: 'n0', name: 'Node 0', loc: 'loc:0', urn: 'hrn:node:example.com:kb:loc:0' }], hasMore: false } });
  });

  it('passes the server answer through for a memory the viewer cannot read: empty, not failed', async () => {
    // findNodes intersects filter.memoryIds with the caller's access; a memory
    // the viewer cannot read is dropped server-side and the honest answer is
    // an empty page. The endpoint must not turn that into a failure state.
    mockRequest.mockResolvedValueOnce({ findNodes: { hits: [] } });
    const body = await (await GET(ev('unreadable', 'viewer-token', '?query=x&offset=0'))).json();
    expect(body).toEqual({ kind: 'ok', value: { items: [], hasMore: false } });
  });

  it('a failed read is distinguishable from an empty result', async () => {
    mockRequest.mockRejectedValueOnce(new Error('transport'));
    const body = await (await GET(ev('m1', 'viewer-token', '?query=x&offset=0'))).json();
    expect(body).toEqual({ kind: 'failed' });
  });

  it('a full page reports more; a short page stops paging', async () => {
    mockRequest.mockResolvedValueOnce({ findNodes: { hits: hits(20) } });
    expect((await (await GET(ev('m1', 'viewer-token', '?query=x&offset=0'))).json()).value.hasMore).toBe(true);
    mockRequest.mockResolvedValueOnce({ findNodes: { hits: hits(7) } });
    expect((await (await GET(ev('m1', 'viewer-token', `?query=x&offset=${20}`))).json()).value.hasMore).toBe(false);
  });

  it('rejects a malformed offset', async () => {
    await expect(GET(ev('m1', 'viewer-token', '?query=x&offset=-1'))).rejects.toMatchObject({ status: 400 });
    await expect(GET(ev('m1', 'viewer-token', '?query=x&offset=zebra'))).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an out-of-range offset and an over-long query (BLIND P2-5: bound what reaches the lexical SQL)', async () => {
    await expect(GET(ev('m1', 'viewer-token', `?query=x&offset=${100_001}`))).rejects.toMatchObject({ status: 400 });
    await expect(GET(ev('m1', 'viewer-token', `?query=${'a'.repeat(501)}&offset=0`))).rejects.toMatchObject({ status: 400 });
    // The bounds are inclusive ceilings, not off-by-one traps.
    mockRequest.mockResolvedValueOnce({ findNodes: { hits: hits(1) } });
    expect((await (await GET(ev('m1', 'viewer-token', `?query=${'a'.repeat(500)}&offset=${100_000}`))).json()).kind).toBe('ok');
  });

  it('reports nextOffset from the RAW page count, so filtered rows cannot shift the client\'s window', async () => {
    // BLIND P2-3: the shape-guard drops unusable rows, but paging is by the
    // raw count the server read. The client pages by nextOffset verbatim.
    mockRequest.mockResolvedValueOnce({ findNodes: { hits: hits(20) } });
    expect((await (await GET(ev('m1', 'viewer-token', '?query=x&offset=0'))).json()).value).toMatchObject({ hasMore: true, nextOffset: 20 });
    mockRequest.mockResolvedValueOnce({ findNodes: { hits: hits(7) } });
    expect((await (await GET(ev('m1', 'viewer-token', '?query=x&offset=20'))).json()).value).toMatchObject({ hasMore: false, nextOffset: 27 });
  });

  it('drops a row without a usable urn instead of passing it downstream', async () => {
    // BLIND P2-3: the server used to keep `urn: ''` (typeof passed) while the
    // client rejected the WHOLE page for it — one validity predicate, applied
    // here, so the client never sees a row it must fail on.
    mockRequest.mockResolvedValueOnce({
      findNodes: { hits: [hit(0), { node: { id: 'n-bad', name: 'No urn', loc: 'loc:x', urn: '' } }, hit(1)] },
    });
    const body = await (await GET(ev('m1', 'viewer-token', '?query=x&offset=0'))).json();
    expect(body.kind).toBe('ok');
    expect(body.value.items.map((n: { id: string }) => n.id)).toEqual(['n0', 'n1']);
    expect(body.value.hasMore).toBe(false); // 3 raw rows < the 20-row page
  });

  it('with no viewer token there is no credential to fall back to: the token passes through as-is', async () => {
    // BLIND P2-5 pin: the endpoint has no service token of its own. An
    // unauthenticated caller reaches the server anonymously, and the server\'s
    // own answer (here: whatever it returns) is what comes back.
    mockRequest.mockResolvedValueOnce({ findNodes: { hits: [] } });
    const body = await (await GET(ev('m1', null, '?query=x&offset=0'))).json();
    expect(gqlClient).toHaveBeenLastCalledWith(null);
    expect(body).toEqual({ kind: 'ok', value: { items: [], hasMore: false, nextOffset: 0 } });
  });
});
