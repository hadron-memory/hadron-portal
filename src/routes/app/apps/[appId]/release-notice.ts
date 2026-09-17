/**
 * #823 — what the page RENDERS for a `releaseWorker` reply.
 *
 * A module rather than a `$derived` in the page because the decision is the
 * interesting half and the markup is not: the old bug was a green success box
 * asserting a release that may not have happened, and a chrome table buried in
 * a 1900-line component can only be checked by rendering the whole App page.
 * Here it is a function with a test.
 */
import { lookupOwn } from '$lib/lookup';
import type { ReleaseOutcome, ReleaseWorkerMessage } from './schema';

export type ReleaseNotice = { text: string; role: 'status' | 'alert'; class: string };

/**
 * Neutral chrome: something happened, and it was not a release. Also the
 * fallback for a success carrying NO outcome — an in-flight reply from an older
 * build, or a future `message()` call that forgets the field. Defaulting that to
 * green would re-assert the exact claim #823 removes, on the one input that says
 * nothing about it.
 */
const NEUTRAL = {
  role: 'status',
  class: 'border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
} as const;

/**
 * A `Record` keyed by the outcome union rather than a ternary chain, so a fourth
 * outcome is a compile error instead of landing silently in the green arm
 * (`hrn:node:hadronmemory.com:hadron-portal:review:widening-a-union-recruits-every-fallback`).
 *
 * `announcement-failed` is the one that takes `role="alert"`. The release
 * succeeded, so the text leads with that — but a notice OTHER PEOPLE rely on did
 * not go out, and a polite `status` in the same green box as an ordinary success
 * is how that reaches nobody
 * (`hrn:node:hadronmemory.com:hadron-portal:review:rendering-is-not-obtaining`).
 */
const CHROME: Record<ReleaseOutcome, { role: 'status' | 'alert'; class: string }> = {
  released: {
    role: 'status',
    class: 'border-green-300 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300',
  },
  'announcement-failed': {
    role: 'alert',
    class: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200',
  },
  'not-held': NEUTRAL,
};

/**
 * The notice to render, or null when there is nothing to render as one — no
 * message, or an error, which the page shows in its own alert box.
 */
export function releaseNotice(message: ReleaseWorkerMessage | undefined | null): ReleaseNotice | null {
  if (message?.type !== 'success') return null;
  // The `|| NEUTRAL` is not dead code the type system already rules out. This
  // message crosses a version boundary: it is composed by the ACTION and read by
  // whichever page bundle the browser happens to be running, so a deploy that
  // adds a fourth outcome reaches an open tab whose `CHROME` has three. The
  // lookup is then `undefined` at runtime while typed non-nullable, and reading
  // `.role` off it throws inside a `$derived` — taking the whole page down to
  // decorate a box. Unknown degrades to neutral, exactly as absent does.
  // #835 — `lookupOwn` for the same cross-version reason the comment above
  // gives. An inherited key is truthy, so `|| NEUTRAL` never fires and `chrome`
  // becomes a function whose `.role` and `.class` are both undefined: the
  // notice renders with no ARIA role, which is the a11y half of the very
  // degradation this fallback exists to prevent.
  const chrome = lookupOwn(CHROME, message.outcome) ?? NEUTRAL;
  return { text: message.text, role: chrome.role, class: chrome.class };
}
