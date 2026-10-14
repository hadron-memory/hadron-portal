/**
 * portal#1067 (hadron-server#1726) — deriving what to say about who a worker
 * REPORTS TO.
 *
 * A Worker reports to at most one other, non-retired Worker of the same App
 * (Holger, 2026-10-09). It is a property of the CASTING, not of a session, so
 * binding or ending a session leaves it alone. Read-only here: setting it
 * (`setWorkerReportsTo`) is a follow-up.
 *
 * ── Masked like the hold ─────────────────────────────────────────────────────
 *
 * `reportsToWorkerId` and `reportsTo` are staffing fields behind the worker
 * read gate and MASKED ON DENY, exactly like `heldByUserId` (see
 * `worker-hold.ts`). A null therefore means "reports to nobody" OR "you may not
 * see". `reportsToRetired` is `Boolean!` and answers `false` on deny. So the
 * honest rendering of `none` is NOTHING: no "Reports to nobody" line, which on a
 * denied read would state a fact the server never disclosed. The portal does
 * not fetch around the mask.
 *
 * ── Retired targets ──────────────────────────────────────────────────────────
 *
 * Retiring a worker clears its OWN reportsTo but leaves the workers reporting
 * to it alone. That stale claim is surfaced (`reportsToRetired`), never hidden:
 * it is exactly what a coordinator reading the roster needs to see.
 */

/** The subset of a Worker this needs, so callers can pass a slim projection. */
export interface WorkerReportsToFields {
  reportsToWorkerId?: string | null;
  reportsToRetired?: boolean;
  /** Selected only by the single-worker read; the roster resolves the target
   *  from its own rows instead of asking the server once per row. */
  reportsTo?: { id: string; name: string; urn?: string | null; retiredAt?: string | null } | null;
}

/** A roster row the target can be resolved from. */
export interface ReportsToTarget {
  id: string;
  name: string;
  urn?: string | null;
  retiredAt?: string | null;
}

export type ReportsTo =
  /** Unset, masked, or not selected. Render nothing. */
  | { kind: 'none' }
  /**
   * A known target. `name` is null when the target could not be resolved (a
   * roster row missing from the page), and the link then carries a generic
   * label rather than a raw id, which names nobody.
   */
  | { kind: 'known'; id: string; name: string | null; urn: string | null; retired: boolean };

export function reportsToOf(
  worker: WorkerReportsToFields | null | undefined,
  roster?: ReadonlyMap<string, ReportsToTarget>,
): ReportsTo {
  const id = worker?.reportsToWorkerId ?? worker?.reportsTo?.id ?? null;
  if (!id) return { kind: 'none' };
  const target = worker?.reportsTo ?? roster?.get(id) ?? null;
  return {
    kind: 'known',
    id,
    name: target?.name ?? null,
    urn: target?.urn ?? null,
    // Either signal is enough: the server's flag, or the target row's own
    // retirement when the roster has it.
    retired: !!worker?.reportsToRetired || !!target?.retiredAt,
  };
}

/**
 * The roster column's sort and search text: the target's name, '' for none.
 *
 * TanStack's sort is stable and the rows arrive name-sorted, so sorting on this
 * groups each worker under the one it reports to, alphabetically within the
 * group, with the workers that report to nobody at the top level (ascending).
 */
export function reportsToSortKey(r: ReportsTo): string {
  return r.kind === 'none' ? '' : (r.name ?? r.id);
}
