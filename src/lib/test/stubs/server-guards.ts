/**
 * Stand-in for `$lib/server/guards` in the table-cell overflow harness
 * (portal#1962 slice 4): the guard reads route `locals` a real SvelteKit
 * request carries, which a mounted harness leg has none of. The node page's
 * loader already ran its auth before these tests in the client lane by
 * mocking this same function to a no-op — same contract here.
 */
export async function requireNonConsumer(): Promise<void> {
  return undefined;
}
