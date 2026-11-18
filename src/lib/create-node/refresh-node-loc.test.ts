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
  it('rejects no progress at that guard, using fresh Responses on every call (#1988)', async () => {
    // The second fresh, valid response bounds the mutant: without the guard it
    // returns a suggestion, rather than failing because a Response was consumed.
    const fetcher = vi.fn()
      .mockImplementationOnce(async () => page([], true))
      .mockImplementation(async () => page([]));
    await expect(refreshedNodeLoc('m', 'self', 'p:old', 'Foo', new AbortController().signal, fetcher))
      .rejects.toThrow('Sibling read made no progress');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects failed=true even with otherwise valid rows and hasMore (#1988)', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ rows: [], hasMore: false, failed: true })));
    await expect(refreshedNodeLoc('m', 'self', 'p:old', 'Foo', new AbortController().signal, fetcher))
      .rejects.toThrow('Invalid sibling page');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, 0, 'false'])('rejects non-boolean hasMore=%s independently (#1988)', async (hasMore) => {
    const fetcher = vi.fn()
      .mockImplementationOnce(async () => new Response(JSON.stringify({ rows: [], hasMore })))
      .mockImplementation(async () => page([]));
    await expect(refreshedNodeLoc('m', 'self', 'p:old', 'Foo', new AbortController().signal, fetcher))
      .rejects.toThrow('Invalid sibling page');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refuses the exhausted collision fallback rather than returning an occupied loc (#1988)', async () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ({
      id: `sibling-${i}`, loc: i === 0 ? 'p:foo' : `p:foo-${i + 1}`,
    }));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const offset = Number(new URL(String(input), 'http://localhost').searchParams.get('offset'));
      return page(rows.slice(offset, offset + 20), offset + 20 < rows.length);
    });
    await expect(refreshedNodeLoc('m', 'self', 'p:old', 'Foo', new AbortController().signal, fetcher))
      .rejects.toThrow('No available suggestion');
    expect(fetcher).toHaveBeenCalledTimes(500);
  });

  it('does not read after cancellation', async () => {
    const controller=new AbortController();controller.abort();const fetcher=vi.fn();
    await expect(refreshedNodeLoc('m','self','p:old','Foo',controller.signal,fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
