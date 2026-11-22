/**
 * Stand-in for `$lib/server/guards` in the table-cell overflow harness
 * (portal#1962 slice 4): the guard reads route `locals` that only a real
 * SvelteKit request carries, and a mounted harness leg has none. The vitest
 * client lane mocks this same function to a no-op for its mounted page
 * tests — same contract here.
 */
export async function requireNonConsumer(): Promise<void> {
  return undefined;
}
