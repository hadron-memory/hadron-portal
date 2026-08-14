/**
 * How a Worker's name is rendered (#974, `cor:agt:020:02` v0.0.3).
 *
 * A Worker name is unique per App, case-insensitively, forever — so it is
 * unambiguous *inside* an App and ambiguous everywhere else. That gives exactly
 * two renderings, and picking between them is a property of the SURFACE, not of
 * the worker:
 *
 * - **In App context** (the staff list, team chat, the worklog): the bare
 *   `Worker.name` — "Iris". Per-App uniqueness guarantees it resolves.
 * - **Org-wide / context-free** (anything read where the App isn't already
 *   established — a session list, a PR trailer): the app-qualified compound
 *   "eng-team/Iris". Never the bare short name: a second App may have its own
 *   Iris, and a human org member may be called Iris too.
 *
 * Identity is always the Worker's columns (`appId`, `agentId`, `name`, `role`).
 * Worker names never appear in slugs or URNs, so nothing here parses a name out
 * of an identifier — the only parsing is pulling the App's own slug off the
 * App's own URN, purely to render it.
 */

import { parseUrnV2 } from '$lib/urn/parse-urn';

/** Separator between the App slug and the worker name in the compound form. */
export const WORKER_QUALIFIER_SEPARATOR = '/';

/**
 * The App's slug — the last atom of its URN (`hrn:app:<root>:<slug>`).
 *
 * Falls back to a last-colon-atom split when the URN isn't canonical v2: the
 * portal still meets legacy spellings, and a slightly-off qualifier reads far
 * better than dropping the qualifier (which would silently produce the bare
 * name the compound form exists to avoid). Returns null only for input with no
 * usable atom at all, so callers can decide what to do with a nameless App.
 */
export function appSlugFromUrn(appUrn: string | null | undefined): string | null {
  if (!appUrn) return null;
  try {
    const parsed = parseUrnV2(appUrn);
    const last = parsed.segments.at(-1);
    if (last) return last;
    // An App URN with no segment past the root shouldn't parse, but if the
    // arity rules ever loosen, the root is still a better qualifier than none.
    return parsed.root || null;
  } catch {
    const atoms = appUrn.split(':').filter((a) => a.length > 0);
    return atoms.at(-1) ?? null;
  }
}

/**
 * The worker's name as rendered on an org-wide or context-free surface:
 * `eng-team/Iris`.
 *
 * When the App slug can't be determined the bare name is returned rather than a
 * half-built qualifier like `/Iris`. That is a deliberate degradation and the
 * only case where an org-wide surface shows a bare name — callers that can
 * afford to hide the row instead should check {@link appSlugFromUrn} first.
 */
export function qualifiedWorkerName(
  workerName: string,
  appSlugOrUrn: string | null | undefined,
): string {
  const slug = appSlugOrUrn?.includes(':')
    ? appSlugFromUrn(appSlugOrUrn)
    : (appSlugOrUrn ?? null);
  if (!slug) return workerName;
  return `${slug}${WORKER_QUALIFIER_SEPARATOR}${workerName}`;
}

/**
 * The one entry point surfaces should call, so the App-context-vs-org-wide
 * choice is made explicitly at every call site instead of being inferred.
 */
export function workerLabel(
  workerName: string,
  opts: { context: 'app' } | { context: 'org-wide'; appSlugOrUrn: string | null | undefined },
): string {
  if (opts.context === 'app') return workerName;
  return qualifiedWorkerName(workerName, opts.appSlugOrUrn);
}
