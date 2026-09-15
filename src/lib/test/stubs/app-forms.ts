/**
 * Stand-in for `$app/forms` in the client test lane (#668).
 *
 * Reached transitively: `sveltekit-superforms` imports `enhance`, so any
 * client test that mounts a page using superforms needs this even when the
 * component never names the module. Aliased rather than mocked for the reason
 * in `app-environment.ts` — resolution happens before mocks exist.
 *
 * `enhance` returns a no-op destroy so `use:enhance` is inert: these tests
 * assert what the DOM OFFERS (which form, carrying which values), never what a
 * submit would do. A stub that pretended to submit would be asserting against
 * itself.
 */
export function enhance(_form: HTMLFormElement, _submit?: unknown): { destroy: () => void } {
  // Superforms calls kit's `enhance` and then reads `.destroy` off the result
  // when its own action is destroyed, so the shape matters even though nothing
  // here submits.
  return { destroy: () => {} };
}

export function applyAction(): Promise<void> {
  return Promise.resolve();
}

export function deserialize(result: string): unknown {
  return JSON.parse(result);
}
