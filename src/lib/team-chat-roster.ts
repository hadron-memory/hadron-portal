/**
 * #855 (@codex on #908) — re-reading the App's worker roster when the team
 * chat's poll brings a message from a worker the page has never seen (one cast
 * after the page loaded), so its author chip can render.
 *
 * Its own module so the rules are TESTED rather than trusted to a page:
 * - ask only for ids the roster lacks (`unknownWorkerIds`), never on a
 *   routine tick;
 * - an id being asked about is not asked again while that read is in flight,
 *   so two overlapping polls cost one read;
 * - an id whose read SUCCEEDED is never asked again, even if the roster still
 *   lacks it (a worker of another App, say) — one read, not one per poll;
 * - an id whose read FAILED is released, so the next poll retries (@codex on
 *   #908: a transient failure must not leave a worker chip-less until reload);
 * - reads that overlap are applied IN ORDER: a result older than one already
 *   applied is dropped (resolves null), so a slow early read can never
 *   replace a newer roster that holds a worker the early one predates (@codex
 *   on #908). Its ids stay asked — the newer roster already covers them.
 */
import { unknownWorkerIds } from '$lib/components/team-chat-thread';
import type { TeamChatMessage } from '$lib/types';

export interface RosterEntry {
  id: string;
  /** Null by contract for a worker of an App whose URN predates grammar v2. */
  urn: string | null;
}

/** Resolves the roster, or null when the read failed in any way. */
export type FetchRoster = () => Promise<RosterEntry[] | null>;

export function createRosterRefresher(fetchRoster: FetchRoster) {
  const asked = new Set<string>();
  let issued = 0;
  let applied = 0;
  return {
    /**
     * Re-read the roster if `items` carry a worker id `knownIds` lacks and that
     * has not been asked about. Resolves the fresh roster, or null when no read
     * was needed or the read failed.
     */
    async refreshFor(
      items: Array<Pick<TeamChatMessage, 'authorWorkerId'>>,
      knownIds: ReadonlySet<string>,
    ): Promise<RosterEntry[] | null> {
      const unknown = unknownWorkerIds(items, knownIds).filter((id) => !asked.has(id));
      if (unknown.length === 0) return null;
      for (const id of unknown) asked.add(id);
      const mine = ++issued;
      let roster: RosterEntry[] | null = null;
      try {
        roster = await fetchRoster();
      } catch {
        roster = null;
      }
      if (!roster) {
        for (const id of unknown) asked.delete(id);
        return null;
      }
      // A newer read already landed: this one is stale, so it is not applied.
      if (mine < applied) return null;
      applied = mine;
      return roster;
    },
  };
}

/**
 * One refresher per ROSTER GENERATION — the page-load roster object it would
 * update (@codex on #908). When the page data reloads (a post of your own
 * invalidates it, say), a read still in flight answers for the OLD roster and
 * the page drops it; had the ids stayed "asked" in a shared refresher, the new
 * roster would never ask again and the chip could not recover. A fresh
 * generation starts with nothing asked, so the next poll re-asks.
 *
 * `generation` is the roster object itself (compared by identity, held
 * weakly), or null when the page-load roster failed — one shared refresher for
 * "no roster", since null === null keeps a result from being dropped.
 */
export function createRosterRefreshers(fetchRoster: FetchRoster) {
  const byGeneration = new WeakMap<object, ReturnType<typeof createRosterRefresher>>();
  let forNull: ReturnType<typeof createRosterRefresher> | null = null;
  return (generation: object | null) => {
    if (generation === null) return (forNull ??= createRosterRefresher(fetchRoster));
    let r = byGeneration.get(generation);
    if (!r) {
      r = createRosterRefresher(fetchRoster);
      byGeneration.set(generation, r);
    }
    return r;
  };
}

/** The page's fetch of `team-chat/authors`, reduced to roster-or-null. */
export function fetchRosterFrom(url: string, fetchFn: typeof fetch = fetch): FetchRoster {
  return async () => {
    const res = await fetchFn(url).catch(() => null);
    if (!res?.ok) return null;
    const body = (await res.json().catch(() => null)) as { workers?: RosterEntry[]; loadFailed?: boolean } | null;
    if (!body || body.loadFailed || !Array.isArray(body.workers)) return null;
    return body.workers;
  };
}
