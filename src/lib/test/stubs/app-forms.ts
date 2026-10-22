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
 *
 * The one exception is `submitEnhancedWithResult` (#957). It still makes no
 * request, but it hands superforms a server result the TEST chose, and
 * `applyAction` records that result as the page's action data, as kit does.
 * What the form then does is superforms' own code, not this stub's.
 */
import { page } from './app-stores';

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

/**
 * #957 — like `submitEnhanced`, then hand superforms the ActionResult the
 * server answered with, through the result handler its submit callback
 * returned. What runs is superforms' own code (reset, `onUpdate(d)`, rebind),
 * given a result a test chose; no request is made, and nothing here decides
 * what the form does with it.
 */
export async function submitEnhancedWithResult(
  form: HTMLFormElement,
  result: { type: 'success' | 'failure'; status: number; data: Record<string, unknown> },
  // Preserve both a pending-result hook and kit-update recording callers.
  opts: { update?: (o?: { reset?: boolean; invalidateAll?: boolean }) => Promise<void>; beforeResult?: () => Promise<void> } | (() => Promise<void>) = {},
): Promise<{ cancelled: boolean }> {
  const submit = enhanced.get(form);
  if (!submit) throw new Error('submitEnhancedWithResult: this form was never enhanced');
  let cancelled = false;
  const action = new URL(form.action || 'http://localhost/');
  const formData = new FormData(form);
  const handler = await submit({
    action,
    formData,
    formElement: form,
    controller: new AbortController(),
    submitter: form.querySelector('[type="submit"]'),
    cancel: () => {
      cancelled = true;
    },
  });
  if (cancelled) return { cancelled };
  if (typeof handler !== 'function') throw new Error('submitEnhancedWithResult: superforms returned no result handler');
  const options = typeof opts === 'function' ? { beforeResult: opts } : opts;
  await options.beforeResult?.();
  await (handler as (event: unknown) => Promise<void>)({ result, action, formData, formElement: form, update: options.update ?? (async () => {}) });
  return { cancelled };
}

/**
 * portal#1237 — like `submitEnhancedWithResult`, but the server's answer arrives
 * LATER: the submit callback runs now (capturing whatever the page held at
 * submit time) and `finish(result)` delivers the result after the test has
 * moved the page on. That is the interleaving a delayed response creates.
 */
export async function submitEnhancedDeferred(form: HTMLFormElement): Promise<{
  finish: (result: { type: 'success' | 'failure'; status: number; data: Record<string, unknown> }) => Promise<void>;
}> {
  const submit = enhanced.get(form);
  if (!submit) throw new Error('submitEnhancedDeferred: this form was never enhanced');
  const action = new URL(form.action || 'http://localhost/');
  const formData = new FormData(form);
  const handler = await submit({
    action, formData, formElement: form, controller: new AbortController(),
    submitter: form.querySelector('[type="submit"]'), cancel: () => {},
  });
  if (typeof handler !== 'function') throw new Error('submitEnhancedDeferred: no result handler');
  return {
    finish: async (result) => {
      await (handler as (event: unknown) => Promise<void>)({ result, action, formData, formElement: form, update: async () => {} });
    },
  };
}

/**
 * What kit's `applyAction` does with a success/failure result: it becomes the
 * page's action data. Superforms (applyAction: true, its default) reacts to
 * that page update, not to its own result handler, so without this nothing
 * downstream of a submit ever runs (#957). A no-op for other result types, and
 * never reached unless a test drives a result through `submitEnhancedWithResult`.
 */
export function applyAction(result?: { type?: string; status?: number; data?: unknown }): Promise<void> {
  if (result && (result.type === 'success' || result.type === 'failure')) {
    page.update((p) => ({ ...p, form: result.data ?? null, status: result.status ?? 200 }));
  }
  return Promise.resolve();
}

export function deserialize(result: string): unknown {
  return JSON.parse(result);
}
