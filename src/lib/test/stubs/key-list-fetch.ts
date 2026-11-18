/**
 * #1653 QA P2: the api-keys page re-reads its list through
 * `/app/account/api-keys/list` after a confirmed delete, never through
 * `invalidateAll()` (a failed `__data.json` there becomes kit's error page and
 * unmounts the page before any catch runs). This stubs that one `fetch` for the
 * client lane: tests choose the answer, can hold it, and read the URL/init
 * calls. Any unrelated endpoint fails deliberately. Unstub with
 * `vi.unstubAllGlobals()`.
 */
import { vi } from 'vitest';
import { KEY_LIST_ENDPOINT } from '../../../routes/app/account/api-keys/key-list';

export type Answer = { keys: unknown[] } | { failed: true } | { status: number; body?: unknown } | { reject: Error } | { body: unknown };

export function stubKeyList(initial: Answer) {
  const calls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  let answer: Answer = initial;
  let held: Promise<void> | null = null;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(rawUrl, 'http://localhost');
    const validQuery = url.search === '' || url.search === '?includeHidden=true';
    if (url.origin !== 'http://localhost' || url.pathname !== KEY_LIST_ENDPOINT || !validQuery) {
      throw new Error(`unexpected fetch: ${rawUrl}`);
    }
    calls.push(`${url.pathname}${url.search}`);
    inits.push(init);
    // The answer is the one set when the request was made, so a held older
    // request still answers with the older list after a newer one lands.
    const mine = answer;
    const wait = held;
    held = null;
    await wait;
    if ('reject' in mine) throw mine.reject;
    if ('status' in mine) {
      const nullBody = mine.status === 204 || mine.status === 205 || mine.status === 304;
      const body = 'body' in mine ? mine.body : { error: 'x' };
      return new Response(nullBody ? null : JSON.stringify(body), { status: mine.status, headers: { 'content-type': 'application/json' } });
    }
    const body = 'body' in mine ? mine.body : mine;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return {
    calls,
    inits,
    answer: (next: Answer) => { answer = next; },
    /** Hold the next answer until the returned release is called. */
    hold: () => {
      let release!: () => void;
      held = new Promise<void>((r) => (release = r));
      return release;
    },
  };
}
