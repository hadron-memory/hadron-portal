import { invalidateAll } from '$app/navigation';

/**
 * Reload the page after a COMMITTED write and say whether the reload landed
 * (portal#2195). Unlike `bestEffortInvalidateAll`, which only warns, this lets a
 * control keep what the server confirmed on screen and tell the person the page
 * may be out of date, instead of presenting the pre-write value as current.
 * A reload that rejects, or never answers within `ms`, is `false`.
 */
export async function readbackAfterWrite(ms = 10_000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms); });
    const reload = invalidateAll().then(() => true as const, () => false as const);
    return await Promise.race([reload, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
