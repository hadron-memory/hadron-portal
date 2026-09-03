/**
 * Stand-in for `$app/navigation` in the client test lane (#795).
 *
 * Aliased in `vitest.config.ts`'s `client` project rather than mocked per-test:
 * the module has no implementation outside a running SvelteKit app, and every
 * component that navigates needs the same recorder. Tests assert on
 * `navigationCalls` and reset it themselves.
 *
 * `replaceState` is the one that matters here — it is the side effect #789's
 * teardown guard exists to prevent, and the reason a lifecycle test can catch
 * that class at all.
 */
export interface NavigationCall {
  fn: string;
  args: unknown[];
}

export const navigationCalls: NavigationCall[] = [];

export function resetNavigationCalls(): void {
  navigationCalls.length = 0;
}

export function replaceState(...args: unknown[]): void {
  navigationCalls.push({ fn: 'replaceState', args });
}

export function pushState(...args: unknown[]): void {
  navigationCalls.push({ fn: 'pushState', args });
}

export function goto(...args: unknown[]): Promise<void> {
  navigationCalls.push({ fn: 'goto', args });
  return Promise.resolve();
}

export function invalidateAll(): Promise<void> {
  navigationCalls.push({ fn: 'invalidateAll', args: [] });
  return Promise.resolve();
}
