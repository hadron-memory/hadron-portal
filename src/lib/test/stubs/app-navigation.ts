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

// portal#1141: a test can hold the NEXT invalidateAll open, to prove what a
// handler does after the reload it started finishes late. Released by the
// returned function; unheld, invalidateAll resolves at once as before.
let heldInvalidate: Promise<void> | null = null;
export function holdInvalidateAll(): () => void {
  let release!: () => void;
  heldInvalidate = new Promise<void>((r) => (release = r));
  return () => {
    heldInvalidate = null;
    release();
  };
}

export function invalidateAll(): Promise<void> {
  navigationCalls.push({ fn: 'invalidateAll', args: [] });
  const held = heldInvalidate;
  heldInvalidate = null;
  return held ?? Promise.resolve();
}

// #668: `sveltekit-superforms` registers a tainted-form guard through these on
// mount, so any client test that mounts a superforms page reaches them even
// when the component never names them. They RECORD rather than no-op, so a test
// that cares can assert the guard was registered; callbacks are kept so a test
// can fire one deliberately.
export const navigationGuards: { fn: string; callback: unknown }[] = [];

export function resetNavigationGuards(): void {
  navigationGuards.length = 0;
}

export function beforeNavigate(callback: unknown): void {
  navigationGuards.push({ fn: 'beforeNavigate', callback });
}

export function afterNavigate(callback: unknown): void {
  navigationGuards.push({ fn: 'afterNavigate', callback });
}

export function onNavigate(callback: unknown): void {
  navigationGuards.push({ fn: 'onNavigate', callback });
}

export function invalidate(...args: unknown[]): Promise<void> {
  navigationCalls.push({ fn: 'invalidate', args });
  return Promise.resolve();
}

export function preloadData(...args: unknown[]): Promise<void> {
  navigationCalls.push({ fn: 'preloadData', args });
  return Promise.resolve();
}
