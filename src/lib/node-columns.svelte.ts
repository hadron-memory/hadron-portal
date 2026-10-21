/**
 * portal#1174 — feeds the Nodes tab its extra columns. `ensure(ids)` reads the
 * columns of the ids it has not asked for yet, one server batch at a time, and
 * merges them into `rows`. Three outcomes per id, kept apart: it loaded, the
 * server would not return it (`unavailable`: denied or gone, never retried), or
 * the read failed (`failed`: thrown or omitted, offered a `retry()`).
 *
 * `reset()` forgets everything asked and loaded, for when the memory refreshed
 * underneath the list (an approval or mint changed what the columns say); a
 * batch still in flight from before the reset is dropped when it lands. A batch
 * that lands after `destroy()` writes nothing (the list was unmounted).
 */
import { loadNodeColumns, type ColumnChunk, type NodeColumnRow } from './node-columns';

export function createNodeColumns(fetchChunk: (refs: string[]) => Promise<ColumnChunk>) {
  let rows = $state<Record<string, NodeColumnRow>>({});
  let failed = $state(0);
  let unavailable = $state(0);
  let loading = $state(0);
  // null until a batch says; false once any batch says signing is off (a deployment fact).
  let signing = $state<boolean | null>(null);
  let destroyed = false;
  // Bumped by reset(): a batch from an older generation is stale.
  let generation = 0;
  const ctl = new AbortController();
  const asked = new Set<string>();
  const failedIds = new Set<string>();
  const unavailableIds = new Set<string>();

  async function load(ids: string[]): Promise<void> {
    if (destroyed || ids.length === 0) return;
    const mine = generation;
    loading += ids.length;
    const returned = new Set<string>();
    const refused = new Set<string>();
    const wrapped = async (refs: string[]) => {
      const chunk = await fetchChunk(refs);
      if (!destroyed && mine === generation && chunk.signing !== undefined && signing !== false) signing = chunk.signing;
      for (const r of chunk.rows) returned.add(r.id);
      for (const id of chunk.unavailable) refused.add(id);
      return chunk;
    };
    const out = await loadNodeColumns(ids, wrapped, { signal: ctl.signal });
    if (destroyed || mine !== generation) {
      // Stale or unmounted: its numbers belong to a state that is gone.
      if (!destroyed && mine !== generation) loading = Math.max(0, loading - ids.length);
      return;
    }
    loading -= ids.length;
    for (const id of ids) {
      if (id in out.rows) failedIds.delete(id);
      else if (refused.has(id)) { failedIds.delete(id); unavailableIds.add(id); }
      else failedIds.add(id); // thrown batch or omitted ref: neither returned nor refused
    }
    rows = { ...rows, ...out.rows };
    unavailable = unavailableIds.size;
    failed = failedIds.size;
  }

  return {
    get rows() { return rows; },
    get failed() { return failed; },
    get unavailable() { return unavailable; },
    get loading() { return loading; },
    get signing() { return signing; },
    async ensure(ids: readonly string[]): Promise<void> {
      if (destroyed) return;
      const fresh = ids.filter((id) => !asked.has(id));
      for (const id of fresh) asked.add(id);
      await load(fresh);
    },
    /** Ask again for the ids whose read failed. Ids the server refused are not retried. */
    async retry(): Promise<void> {
      if (destroyed) return;
      const again = [...failedIds];
      failedIds.clear();
      failed = 0;
      await load(again);
    },
    /** Forget what was asked and loaded; the caller re-ensures what is on screen. */
    reset(): void {
      if (destroyed) return;
      generation++;
      asked.clear();
      failedIds.clear();
      unavailableIds.clear();
      rows = {};
      failed = 0;
      unavailable = 0;
      loading = 0;
    },
    destroy(): void {
      destroyed = true;
      ctl.abort();
    },
  };
}
