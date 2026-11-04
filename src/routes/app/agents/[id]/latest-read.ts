/** What a read came to. `superseded` means a newer read or teardown took its place: drop it. */
export type ReadResult<T> = { kind: 'ok'; body: T } | { kind: 'failed' } | { kind: 'superseded' };

/**
 * JSON reads where only the newest one counts (portal#1667). A new read aborts the one
 * before, and `cancel` ends the last on teardown, so a late response can't land on a
 * view that has moved on. An Agent change remounts the view, which cancels.
 */
export function latestRead() {
  let current: AbortController | null = null;
  return {
    async get<T>(url: string): Promise<ReadResult<T>> {
      current?.abort();
      const mine = new AbortController();
      current = mine;
      try {
        const res = await fetch(url, { signal: mine.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as T;
        return current === mine ? { kind: 'ok', body } : { kind: 'superseded' };
      } catch {
        return current === mine ? { kind: 'failed' } : { kind: 'superseded' };
      }
    },
    cancel() {
      current?.abort();
      current = null;
    },
  };
}
