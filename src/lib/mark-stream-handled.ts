/**
 * portal#1588 QA F2 — mark a streamed loader promise HANDLED at the page
 * that owns it.
 *
 * A rejected promise with no handler attached at the checkpoint is an
 * UNCAUGHT PAGE ERROR. A streamed read (e.g. `nodeMemories`) often reaches
 * its first real consumer only inside a component that mounts lazily — a
 * picker behind an Edit-details panel — or only after hydration, so the
 * failure path rejects into nothing and the browser reports one pageerror
 * per load (Celine, 4/4 in real Chromium; healthy path 0).
 *
 * The page that owns the stream attaches this no-op catch in a `$effect`
 * (so a replacement promise after navigation is covered too). It swallows
 * nothing: a `.catch` never hides a rejection from LATER handlers, so the
 * consumer's own `{#await}/{:catch}` still renders the failure copy.
 *
 * See
 * hrn:node:hadronmemory.com:hadron-portal:review:streamed-promise-passed-to-lazy-consumer-needs-page-level-catch.
 */
export function markStreamHandled<T>(stream: Promise<T> | T): void {
  void Promise.resolve(stream).catch(() => {});
}
