import type { TeamWorkItem } from '$lib/types';

/**
 * Presentation logic for the worklog tab (hadron-portal#733), kept out of the
 * Svelte component so the rules that matter — what links out, and what must
 * NOT be collapsed — are unit-testable without a DOM.
 */

/** The kinds the server accepts as a `kind` filter. Anything else is refused. */
export const WORK_ITEM_KINDS = ['pr', 'issue', 'commit', 'branch', 'repo'] as const;
export type WorkItemKind = (typeof WORK_ITEM_KINDS)[number];

/**
 * Narrow a user-supplied kind to one the server will accept.
 *
 * `teamWorkItems` refuses an unknown `kind` outright, so passing a stray query
 * param straight through turns a bookmarked URL into an error page. Dropping it
 * degrades to "no kind filter", which is the same thing the user sees if they
 * clear the control.
 */
export function normalizeKind(raw: string | null | undefined): WorkItemKind | undefined {
  const k = raw?.trim().toLowerCase();
  return (WORK_ITEM_KINDS as readonly string[]).includes(k ?? '') ? (k as WorkItemKind) : undefined;
}

/** Trim a filter value, treating blank as absent. */
export function normalizeFilter(raw: string | null | undefined): string | undefined {
  const v = raw?.trim();
  return v ? v : undefined;
}

/**
 * The outbound link for a record's artifact, or null when there isn't a safe one.
 *
 * `detail.url` is the documented display extra, but it is stored data rather
 * than a validated field — so it is treated as untrusted: only http(s) is
 * allowed through. A `javascript:` or `data:` URL reaching an href would be a
 * stored-XSS sink, and the worklog is written by every session on the team.
 *
 * Falling back to a constructed GitHub URL is deliberately NOT done here. The
 * server owns ref normalization per tool; guessing a URL from a ref in the
 * client would be the "hand-parsed ref label" mistake the CLI already wrote a
 * review check about, and it would silently produce wrong links for any tool
 * that is not github.
 */
export function artifactHref(item: Pick<TeamWorkItem, 'detail'>): string | null {
  const url = (item.detail as { url?: unknown } | null)?.url;
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

/** The optional human title an artifact may carry. */
export function artifactTitle(item: Pick<TeamWorkItem, 'detail'>): string | null {
  const title = (item.detail as { title?: unknown } | null)?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : null;
}

/**
 * How many DISTINCT worker sessions touched each ref, over the given records.
 *
 * This exists to LABEL the fan-out, never to collapse it. A PR worked across
 * three sessions is three rows and must stay three rows — that spread is the
 * answer the worklog is asked for ("which sessions produced this PR?"), so
 * hiding it behind a rollup would delete the feature.
 *
 * Counts sessions rather than records, because two records from one session
 * (opened, then merged) are one contributor with two milestones, not two
 * contributors.
 */
export function sessionsPerRef(items: readonly TeamWorkItem[]): Map<string, number> {
  const sessionsByRef = new Map<string, Set<string>>();
  for (const item of items) {
    const set = sessionsByRef.get(item.ref) ?? new Set<string>();
    set.add(item.sessionId);
    sessionsByRef.set(item.ref, set);
  }
  return new Map([...sessionsByRef].map(([ref, set]) => [ref, set.size]));
}

/**
 * Tailwind classes for an action chip.
 *
 * Only the actions with a settled meaning are coloured; `action` is a free
 * lowercased string server-side, so an unrecognised verb must render neutrally
 * rather than be forced into the nearest colour.
 */
const ACTION_CLASSES: Record<string, string> = {
  opened: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  merged: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  closed: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  reviewed: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  pushed: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
};
const ACTION_NEUTRAL = 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300';

export function actionClass(action: string): string {
  return ACTION_CLASSES[action?.trim().toLowerCase()] ?? ACTION_NEUTRAL;
}
