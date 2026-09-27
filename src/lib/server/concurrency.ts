/**
 * Map `items` through `fn` with at most `limit` calls in flight, preserving
 * order. For fan-outs whose size scales with the data (one request per App of
 * an organization, …): an unbounded `Promise.all` turns a large org into a
 * request burst against the API on every page load.
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`mapWithConcurrency: limit must be a positive integer, got ${limit}`);
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
