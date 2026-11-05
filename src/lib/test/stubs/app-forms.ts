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
 * portal#1141 — start a submit now and deliver its result LATER: runs the
 * submit callback as kit would and returns a function that hands the result
 * handler the ActionResult a test chose, whenever the test decides. This is
 * how a test proves what a LATE response does after the page moved on (a
 * route change, a newer submit), which `submitEnhancedWithResult` cannot say
 * because it delivers at once.
 */
export async function beginEnhanced(
  form: HTMLFormElement,
  opts: { update?: (o?: { reset?: boolean; invalidateAll?: boolean }) => Promise<void> } = {},
): Promise<(result: { type: 'success' | 'failure'; status: number; data: Record<string, unknown> }) => Promise<void>> {
  const submit = enhanced.get(form);
  if (!submit) throw new Error('beginEnhanced: this form was never enhanced');
  const action = new URL(form.action || 'http://localhost/');
  const formData = new FormData(form);
  const handler = await submit({
    action,
    formData,
    formElement: form,
    controller: new AbortController(),
    submitter: form.querySelector('[type="submit"]'),
    cancel: () => {},
  });
  if (typeof handler !== 'function') throw new Error('beginEnhanced: the submit callback returned no result handler');
  return (result) => (handler as (event: unknown) => Promise<void>)({ result, action, formData, formElement: form, update: opts.update ?? (async () => {}) });
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
 * portal#1528 — like `submitEnhancedWithResult`, but hands the result handler
 * EXACTLY what kit's `enhance` would, including the shapes that are not an
 * ActionResult: `{ type: 'error', error }` for a rejected fetch or a body that
 * is not action JSON (an edge HTML page), and a bare `{ message }` for kit's own
 * CSRF 403. Superforms decides what each one means; this only delivers it.
 */
export async function submitEnhancedWithRawResult(form: HTMLFormElement, result: unknown): Promise<{ cancelled: boolean }> {
  const submit = enhanced.get(form);
  if (!submit) throw new Error('submitEnhancedWithRawResult: this form was never enhanced');
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
  if (typeof handler !== 'function') throw new Error('submitEnhancedWithRawResult: superforms returned no result handler');
  await (handler as (event: unknown) => Promise<void>)({ result, action, formData, formElement: form, update: async () => {} });
  return { cancelled };
}

/**
 * portal#1237 — like `submitEnhancedWithResult`, but the server's answer arrives
 * LATER: the submit callback runs now (capturing whatever the page held at
 * submit time) and `finish(result)` delivers the result after the test has
 * moved the page on. That is the interleaving a delayed response creates.
 */
export async function submitEnhancedDeferred(
  form: HTMLFormElement,
  // portal#1462: a test that needs to see whether a LATE result reached kit's `update` passes its own.
  opts: { update?: (o?: { reset?: boolean; invalidateAll?: boolean }) => Promise<void> } = {},
): Promise<{
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
      await (handler as (event: unknown) => Promise<void>)({ result, action, formData, formElement: form, update: opts.update ?? (async () => {}) });
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
/** Every result handed to `applyAction`, in order. A test empties it itself. */
export const kitAppliedResults: unknown[] = [];

export function applyAction(result?: { type?: string; status?: number; data?: unknown }): Promise<void> {
  kitAppliedResults.push(result);
  if (result && (result.type === 'success' || result.type === 'failure')) {
    // Kit's applyAction resets focus to the document body once the result is
    // applied (portal#1367: a native run saw it land BEFORE a form's own
    // onUpdated). A stub that left focus alone hid that from every mounted test.
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
      // Kit then focuses the body (tabindex -1 for the moment), which FIRES
      // focusin on it: a listener that records the last focused element must
      // not mistake that reset for the reader's own move (a native run saw it).
      const had = document.body.getAttribute('tabindex');
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      if (had === null) document.body.removeAttribute('tabindex');
      else document.body.setAttribute('tabindex', had);
    }
    page.update((p) => ({ ...p, form: result.data ?? null, status: result.status ?? 200 }));
  }
  return Promise.resolve();
}

export function deserialize(result: string): unknown {
  return JSON.parse(result);
}
