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
 * The rejection class that reaches this catch (a throwing `handleError` hook,
 * the root error page itself failing to load, a failed redirect chain) is
 * exactly what kit could NOT report — so this warn is the only record the
 * reload failed. The caller keeps showing its own committed-write outcome.
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
