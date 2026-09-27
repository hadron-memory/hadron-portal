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
/**
 * The submit callback superforms handed kit for each enhanced form, RECORDED,
 * never run by this stub (portal#942). Superforms does its client-side
 * validation inside that callback and calls `cancel()` when the form's own
 * state is invalid, which is a silent no-op in the browser. A test that
 * clicks a confirm button proves nothing about that. `submitEnhanced` drives
 * the recorded callback so a test can see whether the submit would have gone
 * out.
 */
const enhanced = new WeakMap<HTMLFormElement, (input: unknown) => unknown>();

export function enhance(form: HTMLFormElement, submit?: unknown): { destroy: () => void } {
  if (typeof submit === 'function') enhanced.set(form, submit as (input: unknown) => unknown);
  // Superforms calls kit's `enhance` and then reads `.destroy` off the result
  // when its own action is destroyed, so the shape matters even though nothing
  // here submits.
  return { destroy: () => enhanced.delete(form) };
}

/**
 * Run superforms' submit callback for `form` as kit would on submit, and
 * report whether it cancelled. No request is made: the callback's returned
 * result handler is never invoked.
 */
export async function submitEnhanced(form: HTMLFormElement): Promise<{ cancelled: boolean }> {
  const submit = enhanced.get(form);
  if (!submit) throw new Error('submitEnhanced: this form was never enhanced');
  let cancelled = false;
  await submit({
    action: new URL(form.action || 'http://localhost/'),
    formData: new FormData(form),
    formElement: form,
    controller: new AbortController(),
    submitter: form.querySelector('[type="submit"]'),
    cancel: () => {
      cancelled = true;
    },
  });
  return { cancelled };
}

export function applyAction(): Promise<void> {
  return Promise.resolve();
}

export function deserialize(result: string): unknown {
  return JSON.parse(result);
}
