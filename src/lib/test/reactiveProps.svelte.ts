/**
 * A `$state` props object for `mountComponent`, so a test can change props the
 * way a navigation does.
 *
 * `mount()` does not make a plain object reactive, so reassigning a key on the
 * object returned by `mountComponent` changes nothing the component can see —
 * a test written that way passes whatever the component does, which is the
 * false green this file exists to avoid.
 *
 * It lives in a `.svelte.ts` because runes are only compiled there, and the
 * test lanes only include `*.test.ts`.
 *
 * Use it for the defect class where a component is REUSED across a route
 * change and must re-seed
 * (`hrn:node:hadronmemory.com:hadron-portal:review:a-reused-component-must-reseed-its-form`):
 * mount with node A's data, assign node B's, and assert nothing of A survives.
 */
export function reactiveProps<T extends Record<string, unknown>>(initial: T): T {
  const box = $state(initial);
  return box;
}
