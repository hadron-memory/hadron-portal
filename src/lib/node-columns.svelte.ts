/**
 * portal#1174 — feeds the Nodes tab its extra columns. `ensure(ids)` reads the
 * columns of the ids it has not asked for yet, one server batch at a time, and
 * merges them into `rows`. A batch that fails is counted in `failed` and can be
 * `retry()`-ed; one that lands after `destroy()` writes nothing (the list was
 * unmounted while it was in flight).
 */
import { loadNodeColumns, type ColumnChunk, type NodeColumnRow } from './node-columns';

export function createNodeColumns(fetchChunk: (refs: string[]) => Promise<ColumnChunk>) {
  let rows = $state<Record<string, NodeColumnRow>>({});
  let failed = $state(0);
  let unavailable = $state(0);
  let loading = $state(0);
  let destroyed = false;
  const ctl = new AbortController();
  const asked = new Set<string>();
  const failedIds = new Set<string>();

  async function load(ids: string[]): Promise<void> {
    if (destroyed || ids.length === 0) return;
    loading += ids.length;
    const got: string[] = [];
    // Track per-batch failure by diffing: an id neither returned nor reported
    // unavailable is a failure (a thrown batch, or an omitted ref).
    const wrapped = async (refs: string[]) => {
      const chunk = await fetchChunk(refs);
      const seen = new Set([...chunk.rows.map((r) => r.id), ...chunk.unavailable]);
      for (const r of refs) if (!seen.has(r)) failedIds.add(r);
      for (const r of chunk.rows) got.push(r.id);
      return chunk;
    };
    const out = await loadNodeColumns(ids, wrapped, { signal: ctl.signal });
    if (destroyed) return;
    loading -= ids.length;
    // A thrown batch never reached `wrapped`'s diff, so any id with no row and
    // no failure record is from a batch that threw.
    for (const id of ids) if (!(id in out.rows) && !failedIds.has(id)) failedIds.add(id);
    for (const id of Object.keys(out.rows)) failedIds.delete(id);
    rows = { ...rows, ...out.rows };
    unavailable += out.unavailable;
    failed = failedIds.size;
  }

  return {
    get rows() { return rows; },
    get failed() { return failed; },
    get unavailable() { return unavailable; },
    get loading() { return loading; },
    async ensure(ids: readonly string[]): Promise<void> {
      if (destroyed) return;
      const fresh = ids.filter((id) => !asked.has(id));
      for (const id of fresh) asked.add(id);
      await load(fresh);
    },
    /** Ask again for the ids that failed. Ids the server said it would not return are not retried. */
    async retry(): Promise<void> {
      if (destroyed) return;
      const again = [...failedIds];
      failedIds.clear();
      failed = 0;
      await load(again);
    },
    destroy(): void {
      destroyed = true;
      ctl.abort();
    },
  };
}
