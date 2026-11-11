import { describe, expect, it, vi } from 'vitest';
import { refreshedNodeLoc } from './refresh-node-loc';
const page = (rows: Array<{id: string; loc: string}>, hasMore = false) => new Response(JSON.stringify({ rows, hasMore }));
describe('#1902 refreshed loc suggestion', () => {
  it('reads all sibling pages, preserves the saved parent and excludes the current node', async () => {
    const rows = [{ id: 'self', loc: 'p:foo' }, { id: 'one', loc: 'p:new-name' }, ...Array.from({ length: 18 }, (_, i) => ({id: `other${i}`, loc: `p:other${i}`}))];
    const fetcher = vi.fn().mockResolvedValueOnce(page(rows, true)).mockResolvedValueOnce(page([{ id: 'two', loc: 'p:new-name-2' }]));
    expect(await refreshedNodeLoc('memory id', 'self', 'p:foo', 'New_Name!', new AbortController().signal, fetcher)).toBe('p:new-name-3');
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      '/app/memories/memory%20id/nodes/children?parent=p&offset=0',
      '/app/memories/memory%20id/nodes/children?parent=p&offset=20',
    ]);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: 'no-store', signal: expect.any(AbortSignal) });
  });
  it('does not count the node itself as a collision', async () => {
    const fetcher = vi.fn().mockResolvedValue(page([{id: 'self', loc: 'p:foo'}]));
    expect(await refreshedNodeLoc('m', 'self', 'p:foo', 'FOO', new AbortController().signal, fetcher)).toBe('p:foo');
  });
  it('supports root-level and empty-slug fallback', async () => {
    const fetcher = vi.fn().mockResolvedValue(page([{id: 'taken', loc: 'untitled'}]));
    expect(await refreshedNodeLoc('m', 'self', 'old', '!!!', new AbortController().signal, fetcher)).toBe('untitled-2');
  });
  it.each([
    () => new Response('{}', {status:500}),
    () => new Response(JSON.stringify({failed:true})),
    () => page([],true), // malformed no-progress page, deliberately not a legal server page
    () => page([{id:'wrong-parent',loc:'other:foo'}]),
    () => new Response('not json'),
  ])('refuses an incomplete/unusable read rather than inventing availability (%#)', async response => {
    const fetcher = vi.fn().mockResolvedValue(response());
    await expect(refreshedNodeLoc('m','self','p:old','Foo',new AbortController().signal,fetcher)).rejects.toThrow();
  });
  it('does not read after cancellation', async () => {
    const controller=new AbortController();controller.abort();const fetcher=vi.fn();
    await expect(refreshedNodeLoc('m','self','p:old','Foo',controller.signal,fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
