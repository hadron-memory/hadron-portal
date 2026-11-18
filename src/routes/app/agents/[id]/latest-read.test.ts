import { afterEach, describe, expect, it, vi } from 'vitest';
import { latestRead } from './latest-read';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
/** Each call waits until the test settles it, and ignores its abort signal, as a slow network can. */
function heldFetch() {
  const calls: Array<{ signal: AbortSignal; resolve: (r: Response) => void; reject: (e: Error) => void }> = [];
  vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise<Response>((resolve, reject) => calls.push({ signal: init.signal!, resolve, reject }))));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe('latestRead (portal#1667)', () => {
  it('answers with the body of an ok response', async () => {
    const calls = heldFetch();
    const read = latestRead().get('/x');
    calls[0].resolve(json({ a: 1 }));
    expect(await read).toEqual({ kind: 'ok', body: { a: 1 } });
  });
  it('a failing status is a failure even with a JSON body', async () => {
    const calls = heldFetch();
    const read = latestRead().get('/x');
    calls[0].resolve(json({ node: { id: 'n' } }, 502));
    expect(await read).toEqual({ kind: 'failed' });
  });
  it('a newer read aborts the one before and only the newest answers', async () => {
    const calls = heldFetch();
    const reader = latestRead();
    const first = reader.get('/x');
    const second = reader.get('/x');
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);
    calls[1].resolve(json({ n: 2 }));
    calls[0].resolve(json({ n: 1 }));
    expect(await first).toEqual({ kind: 'superseded' });
    expect(await second).toEqual({ kind: 'ok', body: { n: 2 } });
  });
  it('an older read that fails is superseded, not a failure', async () => {
    const calls = heldFetch();
    const reader = latestRead();
    const first = reader.get('/x');
    void reader.get('/x');
    calls[0].reject(new Error('aborted'));
    expect(await first).toEqual({ kind: 'superseded' });
  });
  it('cancel aborts the read, and a late answer is dropped', async () => {
    const calls = heldFetch();
    const reader = latestRead();
    const read = reader.get('/x');
    reader.cancel();
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].resolve(json({ late: true }));
    expect(await read).toEqual({ kind: 'superseded' });
  });
});
