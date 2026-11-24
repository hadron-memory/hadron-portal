/**
 * portal#2436 item 6: a request whose server read fails during page load must not vanish
 * without a word. It is kept in the cookie for the next visit AND counted, so the page can say
 * it could not check.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '$env/dynamic/public';
import { loadPending } from './secret-pending';
import { READ_FAILURE_LIMIT, TRACKED_COOKIE } from '$lib/secrets/tracked';

const LINK = 'https://h.example/secret-changes/';
const tracked = (ids: string[]) => JSON.stringify(ids.map((id) => ({ requestId: id, ceremonyUrl: `${LINK}${id}`, secretId: 's1' })));
const cookiesOf = (ids: string[]) => ({ get: (n: string) => (n === TRACKED_COOKIE ? tracked(ids) : undefined), set: vi.fn(), delete: vi.fn() }) as never;
/** A jar that remembers what was written, so a test can read back what the cookie still holds. */
function jarOf(initial: object[]) {
  const store = new Map<string, string>([[TRACKED_COOKIE, JSON.stringify(initial)]]);
  const cookies = { get: (n: string) => store.get(n), set: vi.fn((n: string, v: string) => void store.set(n, v)), delete: vi.fn((n: string) => void store.delete(n)) };
  const held = () => (store.has(TRACKED_COOKIE) ? (JSON.parse(store.get(TRACKED_COOKIE)!) as Array<{ requestId: string; misses?: number }>) : []);
  return { cookies: cookies as never, spy: cookies, held };
}
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
    expect(r.unchecked).toBe(1);
    expect((cookies as unknown as { set: ReturnType<typeof vi.fn> }).set).toHaveBeenCalledTimes(1);
  });
  // Kills: treating a failed read like a vanished one (dropping it from the cookie). The old pin only saw that
  // nothing was SET, so a request dropped on failure still passed; this reads back what the cookie holds.
  it('a failed read stays in the cookie while a vanished one beside it is dropped', async () => {
    const j = jarOf([{ requestId: 'r1', secretId: 's1' }, { requestId: 'r2', secretId: 's1' }]);
    const r = await loadPending(clientOf({ r1: new Error('down'), r2: { secretChangeRequest: null } }), j.cookies, () => true);
    expect(r.unchecked).toBe(1);
    expect(j.held().map((x) => x.requestId)).toEqual(['r1']);
  });
  // Kills: changing the limit itself. The other tests import the constant, so a changed value would move with them.
  it('the limit is five failed loads in a row', () => { expect(READ_FAILURE_LIMIT).toBe(5); });
  // Kills: dropping the limit check (a failing read re-read forever) or counting from the wrong side of it.
  it(`a read that keeps failing is counted each load and dropped after ${READ_FAILURE_LIMIT} in a row`, async () => {
    let held: object[] = [{ requestId: 'r1', secretId: 's1' }];
    for (let load = 1; load <= READ_FAILURE_LIMIT; load++) {
      const j = jarOf(held);
      const r = await loadPending(clientOf({ r1: new Error('down') }), j.cookies, () => true);
      expect(r.unchecked).toBe(1); // still told about, including on the last try
      held = j.held();
      expect(held).toHaveLength(load < READ_FAILURE_LIMIT ? 1 : 0);
    }
  });
  // Kills: never clearing the count, so a request that failed twice and then read fine is a few failures from being dropped.
  it('a read that works clears its failure count', async () => {
    const j = jarOf([{ requestId: 'r1', secretId: 's1', misses: READ_FAILURE_LIMIT - 1 }]);
    const r = await loadPending(clientOf({ r1: found('r1') }), j.cookies, () => true);
    expect(r.rows).toHaveLength(1);
    expect(j.held()).toEqual([{ requestId: 'r1', secretId: 's1' }]);
  });
  // Kills: the readOnly guard around the failure write: an impersonated visit would write the admin's cookie.
  it('a read-only (impersonated) load that fails counts it and writes nothing', async () => {
    const j = jarOf([{ requestId: 'r1', secretId: 's1', misses: READ_FAILURE_LIMIT - 1 }]);
    const r = await loadPending(clientOf({ r1: new Error('down') }), j.cookies, () => true, true);
    expect(r.unchecked).toBe(1);
    expect(j.spy.set).not.toHaveBeenCalled();
    expect(j.spy.delete).not.toHaveBeenCalled();
  });
  it('a read that worked shows its row and counts nothing', async () => {
    const r = await loadPending(clientOf({ r1: found('r1') }), cookiesOf(['r1']), () => true);
    expect(r.rows.map((x) => x.requestId)).toEqual(['r1']);
    expect(r.unchecked).toBe(0);
  });
  it('a mixed load shows the rows it could read and counts the rest', async () => {
    const r = await loadPending(clientOf({ r1: found('r1'), r2: new Error('down'), r3: found('r3') }), cookiesOf(['r1', 'r2', 'r3']), () => true);
    expect(r.rows.map((x) => x.requestId)).toEqual(['r1', 'r3']);
    expect(r.unchecked).toBe(1);
  });
  it('a request the server no longer shows is dropped and not counted as unchecked', async () => {
    const cookies = cookiesOf(['r1']);
    const r = await loadPending(clientOf({ r1: { secretChangeRequest: null } }), cookies, () => true);
    expect(r).toEqual({ rows: [], unchecked: 0 });
    expect((cookies as unknown as { delete: ReturnType<typeof vi.fn> }).delete).toHaveBeenCalled();
  });
  it('a request the match does not select is neither read nor counted', async () => {
    const r = await loadPending(clientOf({ r1: new Error('down') }), cookiesOf(['r1']), () => false);
    expect(r).toEqual({ rows: [], unchecked: 0 });
  });
});
