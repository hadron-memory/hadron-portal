/**
 * Bound an OPTIONAL request: settle to `fallback` if `work` has not settled in
 * `ms`. Catching a rejection covers a request that fails; it does not cover one
 * that hangs, and a loader that awaits a hung list holds every tab of the page
 * for lists only one or two tabs draw. The work is not cancelled — its result is
 * simply no longer waited for.
 */
export function withTimeout<T, F>(work: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<F>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([work, bound]).finally(() => clearTimeout(timer));
}

/** How long the App page waits for a list that only a secondary tab draws. */
export const OPTIONAL_LIST_TIMEOUT_MS = 8000;
