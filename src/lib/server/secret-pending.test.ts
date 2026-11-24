/**
 * portal#2436 item 6: a request whose server read fails during page load must not vanish
 * without a word. It is kept in the cookie for the next visit AND counted, so the page can say
 * it could not check.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '$env/dynamic/public';
import { loadPending } from './secret-pending';
import { TRACKED_COOKIE } from '$lib/secrets/tracked';

const LINK = 'https://h.example/secret-changes/';
const tracked = (ids: string[]) => JSON.stringify(ids.map((id) => ({ requestId: id, ceremonyUrl: `${LINK}${id}`, secretId: 's1' })));
const cookiesOf = (ids: string[]) => ({ get: (n: string) => (n === TRACKED_COOKIE ? tracked(ids) : undefined), set: vi.fn(), delete: vi.fn() }) as never;
const found = (id: string, state = 'open') => ({ secretChangeRequest: { id, state, operation: 'STORE', expiresAt: '2026-11-21T01:00:00Z' } });
/** One answer per request id: a value, null, or an Error for a failed read. */
const clientOf = (by: Record<string, unknown>) => ({
  request: async (_q: string, v: { id: string }) => {
    const a = by[v.id];
    if (a instanceof Error) throw a;
    return a;
  },
}) as never;

beforeEach(() => { env.PUBLIC_SERVER_URL = 'https://h.example'; vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); });

describe('loadPending counts the reads that failed (portal#2436)', () => {
  it('a failed read is counted, not shown as a row, and stays in the cookie', async () => {
    const cookies = cookiesOf(['r1']);
    const r = await loadPending(clientOf({ r1: new Error('down') }), cookies, () => true);
    expect(r.rows).toEqual([]);
    expect(r.unread).toBe(1);
    expect((cookies as unknown as { set: ReturnType<typeof vi.fn> }).set).not.toHaveBeenCalled();
  });
  it('a read that worked shows its row and counts nothing', async () => {
    const r = await loadPending(clientOf({ r1: found('r1') }), cookiesOf(['r1']), () => true);
    expect(r.rows.map((x) => x.requestId)).toEqual(['r1']);
    expect(r.unread).toBe(0);
  });
  it('a mixed load shows the rows it could read and counts the rest', async () => {
    const r = await loadPending(clientOf({ r1: found('r1'), r2: new Error('down'), r3: found('r3') }), cookiesOf(['r1', 'r2', 'r3']), () => true);
    expect(r.rows.map((x) => x.requestId)).toEqual(['r1', 'r3']);
    expect(r.unread).toBe(1);
  });
  it('a request the server no longer shows is dropped and not counted as unread', async () => {
    const cookies = cookiesOf(['r1']);
    const r = await loadPending(clientOf({ r1: { secretChangeRequest: null } }), cookies, () => true);
    expect(r).toEqual({ rows: [], unread: 0 });
    expect((cookies as unknown as { delete: ReturnType<typeof vi.fn> }).delete).toHaveBeenCalled();
  });
  it('a request the match does not select is neither read nor counted', async () => {
    const r = await loadPending(clientOf({ r1: new Error('down') }), cookiesOf(['r1']), () => false);
    expect(r).toEqual({ rows: [], unread: 0 });
  });
});
