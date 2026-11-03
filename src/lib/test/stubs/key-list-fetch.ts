/**
 * #1653 QA P2: the api-keys page re-reads its list through
 * `/app/account/api-keys/list` after a confirmed delete, never through
 * `invalidateAll()` (a failed `__data.json` there becomes kit's error page and
 * unmounts the page before any catch runs). This stubs that one `fetch` for the
 * client lane: tests choose the answer, can hold it, and read the calls.
 * Unstub with `vi.unstubAllGlobals()`.
 */
import { vi } from 'vitest';

type Answer = { keys: unknown[] } | { failed: true } | { status: number } | { reject: Error } | { body: unknown };

export function stubKeyList(initial: Answer) {
  const calls: string[] = [];
  let answer: Answer = initial;
  let held: Promise<void> | null = null;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    // The answer is the one set when the request was made, so a held older
    // request still answers with the older list after a newer one lands.
    const mine = answer;
    const wait = held;
    held = null;
    await wait;
    if ('reject' in mine) throw mine.reject;
    if ('status' in mine) return new Response('{"error":"x"}', { status: mine.status, headers: { 'content-type': 'application/json' } });
    const body = 'body' in mine ? mine.body : mine;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return {
    calls,
    answer: (next: Answer) => { answer = next; },
    /** Hold the next answer until the returned release is called. */
    hold: () => {
      let release!: () => void;
      held = new Promise<void>((r) => (release = r));
      return release;
    },
  };
}
