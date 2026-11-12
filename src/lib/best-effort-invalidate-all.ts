import { invalidateAll } from '$app/navigation';

/**
 * Reload the page after a COMMITTED write, best-effort (portal#1980).
 *
 * A continuation that awaits `invalidateAll()` after a save must not throw:
 * inside a superforms `onResult`, a throw is answered with an error result
 * (superForm.js `setErrorResult`, and its default onError rethrows), which
 * replaces a KNOWN action failure — message and typed fields — with a generic
 * error, even though the write is already saved server-side. Anywhere else, an
 * escaping rejection is an unhandled one.
 *
 * Kit resolves most handled load failures through the error boundary WITHOUT
 * rejecting `invalidateAll()` — that path replaces the page and no catch can
 * preserve an outcome across it
 * (hrn:node:hadronmemory.com:hadron-portal:review:uncertain-mutation-outcome-outlives-action).
 * Verified against @sveltejs/kit 2.55.0 `src/runtime/client/client.js`:
 * `invalidateAll()` returns `_invalidate()`'s promise, and `_invalidate` awaits
 * `load_route` directly — so a `load_route` rejection reaches this catch.
 * `load_route` itself catches server-load errors and answers
 * `load_root_error_page` (resolved, not rejected); what still rejects is
 * exactly what kit could NOT report: `handle_error` awaits the app's
 * `handleError` hook, so a throwing hook rejects; the root error page's own
 * load failing rethrows out of `load_root_error_page` (only `Redirect` chains
 * on); and a redirect answer chains through `_goto`, whose failure propagates.
 * So this warn is the only record the reload failed. The caller keeps showing
 * its own committed-write outcome.
 *
 * `scope` prefixes the warn like the page's other `[scope] …` diagnostics.
 */
export async function bestEffortInvalidateAll(scope: string): Promise<void> {
  try {
    await invalidateAll();
  } catch (e) {
    console.warn(`[${scope}] saved, but the reload after it failed:`, e);
  }
}
