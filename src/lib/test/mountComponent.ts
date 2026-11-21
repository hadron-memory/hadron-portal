import { flushSync, mount, unmount } from 'svelte';
import type { Component } from 'svelte';
import { idleStatusRegions } from './firstPopulatedStatusText';

/**
 * Mount a component into a real DOM for a `*.client.test.ts` (#795).
 *
 * The repo's other component tests use `render` from `svelte/server`, which
 * produces markup and **never mounts** — so `onMount`, `onDestroy`, effects and
 * every teardown path never execute there. This is the second harness, not a
 * replacement: SSR correctness still matters and those tests keep their lane.
 *
 * ## `unmount` is the half that matters
 *
 * Mounting is the easy part, and a harness that only mounts would miss the
 * entire class of defect that motivated this. Both shipped bugs were about what
 * happens AFTER teardown: an async `onMount` continuing against a torn-down
 * container (#782/#788), and a continuation rewriting the URL of a page the
 * user had left (#789/#794). So `unmount` is returned first and every helper
 * here is built to make "and then it was destroyed" easy to express.
 *
 * ## Why the awaits are explicit
 *
 * Svelte 5 batches. `flushSync()` settles synchronous effects; a microtask tick
 * is what lets an `await`ed continuation inside `onMount` resume. A test that
 * omits either passes for the wrong reason — it asserts on a component that has
 * not finished starting, which is indistinguishable from one that behaved.
 */
export interface Mounted<Props extends Record<string, unknown>> {
  /** Tear the component down — the operation most of these tests are about. */
  unmount: () => void;
  /** The element the component was mounted into. */
  target: HTMLElement;
  /** The mounted instance, for `$state` inspection where a component exports it. */
  instance: Record<string, unknown>;
  props: Props;
}

/**
 * Mount `component` into a fresh detached-then-attached target.
 *
 * The target is appended to `document.body` rather than left floating, because
 * a detached container silently changes behaviour that depends on layout or on
 * `isConnected` — and "the test passed because nothing was ever really in the
 * document" is exactly the false green this harness exists to remove.
 */
/** Status regions that existed, empty, the moment each target finished mounting (portal#2344). */
const idleByTarget = new WeakMap<HTMLElement, HTMLElement[]>();

/**
 * The `role="status"` regions that existed and were empty right after the mount
 * that contains `scope`. A region that speaks later must be one of these: it was
 * already in the DOM, and only its content changed. A conditionally mounted
 * region is not, which is the defect `LiveRegion` exists to prevent.
 *
 *     expect(idleStatusAtMount(root)).toContain(announcedStatusRegion(root));
 */
export function idleStatusAtMount(scope: Element): HTMLElement[] {
  for (let el: Element | null = scope; el; el = el.parentElement) {
    const found = idleStatusAtMount_(el);
    if (found) return found;
  }
  return [];
}
function idleStatusAtMount_(el: Element): HTMLElement[] | undefined {
  return el instanceof HTMLElement ? idleByTarget.get(el) : undefined;
}

export function mountComponent<Props extends Record<string, unknown>>(
  component: Component<Props, Record<string, unknown>>,
  props: Props,
): Mounted<Props> {
  const target = document.createElement('div');
  document.body.appendChild(target);

  // If the component throws during init, the target must not be left attached
  // (@copilot). A leaked node bleeds into the next test and makes the FOLLOW-ON
  // failure the confusing one — the original throw is at least legible.
  let instance: Record<string, unknown>;
  try {
    instance = mount(component, { target, props }) as Record<string, unknown>;
    flushSync();
    idleByTarget.set(target, idleStatusRegions(target));
  } catch (e) {
    target.remove();
    throw e;
  }

  let done = false;
  return {
    target,
    instance,
    props,
    unmount: () => {
      // Idempotent: a test that unmounts explicitly AND registers cleanup would
      // otherwise double-unmount, which throws and reads as a failure of the
      // code under test rather than of the test.
      if (done) return;
      done = true;
      unmount(instance);
      flushSync();
      target.remove();
    },
  };
}

/**
 * Let pending microtasks run — the gap an `await` inside `onMount` resumes in.
 *
 * `flushSync()` alone is not enough: it settles Svelte's own effect queue, not
 * a promise continuation. A teardown-window test needs both, and needs them in
 * this order: unmount, then let the continuation land on the corpse.
 */
export async function tick(times = 1): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
  flushSync();
}

/**
 * Resolve after `ms` — for a continuation parked behind a real timer rather
 * than a bare microtask. Prefer `tick()`; reach for this only when the code
 * under test genuinely waits on the clock.
 */
export function wait(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run `fn` and return whatever an async `onMount` threw into the void.
 *
 * **This, not `mount()`, is what makes the #782 class visible to a test**, and
 * it was the one thing a mount-only harness still could not see. An async
 * `onMount` returns a promise NOBODY AWAITS: when its continuation throws after
 * teardown, the error never reaches the caller, the render, or the assertion —
 * it surfaces as an unhandled rejection and, outside a test, as a permanently
 * red console that nobody connects to the feature that still appears to work.
 *
 * Discovered the hard way while building this harness: the first version of the
 * AC1 test did `await expect(tick()).rejects…` and failed, because the
 * rejection is not on that promise or on any promise the test can reach. #795
 * predicted this in prose ("not as a component error, not as a failed render,
 * not in any test") — it is still worth a helper rather than a warning.
 *
 * Listening on `process` rather than `window`: the continuation is a Node
 * promise (vitest runs jsdom inside node), so `unhandledrejection` on the jsdom
 * window never fires for it. Handling the event also stops vitest reporting it
 * as an unhandled error and failing the file, which is the difference between
 * "the suite is red for a reason the test states" and "the suite is red".
 */
export async function captureUnhandledRejections(fn: () => Promise<void>): Promise<unknown[]> {
  const caught: unknown[] = [];
  const onRejection = (err: unknown) => { caught.push(err); };
  process.on('unhandledRejection', onRejection);
  try {
    await fn();
    // A rejection is delivered on a later turn than the throw, so the window
    // has to stay open past the caller's own awaits or this returns empty and
    // the test passes for the wrong reason.
    await wait(0);
    return caught;
  } finally {
    process.off('unhandledRejection', onRejection);
  }
}
