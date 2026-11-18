import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhanced, submitEnhancedDeferred, submitEnhancedWithResult, submitEnhancedWithRawResult } from '$lib/test/stubs/app-forms';
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import Dialog from './WorkerDeleteDialog.svelte';
const worker = (id = 'one') => ({ id, name: id, urn: `hrn:worker:acme.com:app:${id}` });
let mounted: ReturnType<typeof mountComponent> | undefined;
let oldShow: PropertyDescriptor | undefined, oldClose: PropertyDescriptor | undefined;
beforeAll(() => {
  oldShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal'); oldClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
});
afterAll(() => {
  for (const [key, old] of [['showModal', oldShow], ['close', oldClose]] as const) { if (old) Object.defineProperty(HTMLDialogElement.prototype, key, old); else Reflect.deleteProperty(HTMLDialogElement.prototype, key); }
});
afterEach(() => { mounted?.unmount(); mounted = undefined; });
beforeEach(() => resetNavigationCalls());
const open = () => {
  const onclose = vi.fn(); const props = reactiveProps({ worker: worker(), onclose });
  mounted = mountComponent(Dialog, props); return { props, onclose };
};
const form = () => document.querySelector('form')!;
const check = async () => { const box = document.querySelector<HTMLInputElement>('input[type=checkbox]')!; box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); flushSync(); await tick(); };
const result = (ok: boolean, workerRef = 'one') => ({ type: ok ? 'success' as const : 'failure' as const, status: ok ? 200 : 400,
  data: { deleteWorkerResult: { ok, workerRef, code: ok ? null : 'WORKER_IN_USE', message: '<b>Refusal</b> {{> no}}' } } });
it('identifies the worker and requires an unchecked explicit external-artifact attestation', async () => {
  open(); await tick();
  expect(document.body.textContent).toContain('database checks cannot establish absence of externally signed artifacts');
  expect(document.body.textContent?.replace(/\s+/g, '')).toContain('hrn:worker:acme.com:app:one');
  expect(document.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
  expect((await submitEnhanced(form())).cancelled).toBe(true);
  await check();
  expect((await submitEnhancedWithResult(form(), result(false))).cancelled).toBe(false);
});
it('keeps refusal text escaped, target intact and roster unrefreshed', async () => {
  const { onclose } = open(); await tick(); await check();
  await submitEnhancedWithResult(form(), result(false)); flushSync(); await tick();
  expect(document.querySelector('[role=alert]')?.textContent).toContain('<b>Refusal</b>');
  expect(document.querySelector('[role=alert] b')).toBeNull();
  expect(onclose).not.toHaveBeenCalled(); expect(navigationCalls).toHaveLength(0);
  expect(new FormData(form()).get('workerRef')).toBe('one');
});
it('rejects a mismatched worker response as an unknown outcome: latched, best-effort refreshed, target unchanged', async () => {
  const { props, onclose } = open(); await tick(); await check();
  const selected = props.worker;
  const pending = await submitEnhancedDeferred(form()); flushSync(); await tick();
  expect(document.querySelector('[role=status]')?.textContent).toContain('Deleting the selected worker');
  await pending.finish(result(true, 'other-worker')); flushSync(); await tick();
  // portal#2260 round 1, Gil F1 — an answer about a DIFFERENT worker is no
  // answer about this one: the selected worker's outcome is unknown, so the
  // leg latches exactly like a 502 uncertain answer (Submit stays disabled —
  // a retry would re-post a delete that may already have committed) and the
  // page best-effort refreshes (F3) so an authoritative re-read can resolve
  // it. The target is still not changed by the mismatch.
  expect(document.querySelector('[role=alert]')?.textContent).toContain('may have succeeded');
  expect(document.querySelector('[role=status]')).toBeNull();
  expect(document.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  expect(document.querySelector<HTMLDialogElement>('dialog')!.open).toBe(true);
  expect(onclose).not.toHaveBeenCalled();
  expect(navigationCalls.some(c => c.fn === 'invalidateAll')).toBe(true);
  expect(props.worker).toBe(selected);
  expect(new FormData(form()).get('workerRef')).toBe('one');
});
it('guards duplicate submits and refreshes authoritative data only on confirmed success', async () => {
  const { onclose } = open(); await tick(); await check();
  const pending = await submitEnhancedDeferred(form());
  expect((await submitEnhanced(form())).cancelled).toBe(true);
  await pending.finish(result(true));
  expect(navigationCalls.some(c => c.fn === 'invalidateAll')).toBe(true); expect(onclose).toHaveBeenCalledOnce();
});
it('resets consent on a target change and ignores a late result for the former worker', async () => {
  const { props, onclose } = open(); await tick(); await check();
  const pending = await submitEnhancedDeferred(form()); props.worker = worker('two'); flushSync(); await tick();
  expect(document.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
  await pending.finish(result(true));
  expect(onclose).not.toHaveBeenCalled(); expect(navigationCalls).toHaveLength(0);
  expect(new FormData(form()).get('workerRef')).toBe('two');
});
it('cancel never submits, clears confirmation, and a fresh opening is unchecked', async () => {
  const { onclose } = open(); await tick(); await check();
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Cancel')!.click(); flushSync();
  expect(onclose).toHaveBeenCalledOnce(); expect(navigationCalls).toHaveLength(0);
  mounted!.unmount(); mounted = undefined; open(); await tick();
  expect(document.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
});

it('ignores a response after A-B-A navigation despite matching the original worker ID', async () => {
  const { props, onclose } = open(); await tick(); await check();
  const pending = await submitEnhancedDeferred(form());
  props.worker = worker('two'); await tick();
  props.worker = worker(); await tick();
  await pending.finish(result(false));
  expect(document.querySelector('[role=alert]')).toBeNull();
  expect(document.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
  expect(onclose).not.toHaveBeenCalled();
});
it('does not close a new target when the previous success finishes refreshing', async () => {
  const { props, onclose } = open(); await tick(); await check();
  navigationHooks.onInvalidateAll = async () => { props.worker = worker('two'); await tick(); };
  await submitEnhancedWithResult(form(), result(true));
  expect(onclose).not.toHaveBeenCalled();
  expect(new FormData(form()).get('workerRef')).toBe('two');
  expect(document.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
});
it('ignores a response after teardown', async () => {
  const { onclose } = open(); await tick(); await check();
  const pending = await submitEnhancedDeferred(form());
  mounted!.unmount(); mounted = undefined;
  await pending.finish(result(true));
  expect(onclose).not.toHaveBeenCalled(); expect(navigationCalls).toHaveLength(0);
});
it('a failed roster refresh cannot enable a second deletion', async () => {
  open(); await tick(); await check();
  navigationHooks.onInvalidateAll = async () => { throw new Error('refresh unavailable'); };
  await submitEnhancedWithResult(form(), result(true)); await tick();
  expect(document.querySelector('[role=alert]')?.textContent).toContain('worker was deleted');
  expect((await submitEnhanced(form())).cancelled).toBe(true);
});
it('portal#2205: a redirect answer is the worker page’s success — FOLLOWED, never read as a refusal', async () => {
  const { onclose } = open(); await tick(); await check();
  await submitEnhancedWithRawResult(form(), { type: 'redirect', status: 303, location: '/app/apps/app-one?tab=staff' }); flushSync(); await tick();
  // A custom enhance callback REPLACES Kit's default result handling, so
  // following the redirect is the callback's own job: without an explicit
  // goto, pending stays true forever and the modal can never be closed while
  // the worker is already deleted.
  expect(navigationCalls).toContainEqual({ fn: 'goto', args: ['/app/apps/app-one?tab=staff'] });
  // No "Deletion was not confirmed" misread of the empty data, and nothing
  // invalidated behind a page whose URL is about to stop resolving: the
  // redirect itself carries the reader to the roster.
  expect(document.querySelector('[role=alert]')).toBeNull();
  expect(navigationCalls.some(c => c.fn === 'invalidateAll')).toBe(false);
  expect(onclose).not.toHaveBeenCalled();
});
it('portal#2205: if following the delete redirect fails, Submit stays latched and only Cancel/Escape release', async () => {
  const { onclose } = open(); await tick(); await check();
  navigationHooks.onGoto = async () => { throw new Error('navigation unavailable'); };
  await submitEnhancedWithRawResult(form(), { type: 'redirect', status: 303, location: '/app/apps/app-one?tab=staff' }); flushSync(); await tick();
  expect(document.querySelector('[role=status]')).toBeNull();
  // The redirect answer means the delete SUCCEEDED — the worker is gone. A
  // retry would re-post the delete for a worker that no longer exists and
  // read WORKER_NOT_FOUND as a refusal, so the latch must hold (Gino F1):
  // Submit disabled, and a forced second submit cancelled by the guard.
  expect(document.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  expect((await submitEnhanced(form())).cancelled).toBe(true);
  // The modal is not a trap: Cancel stays enabled and closes (Gino F1's
  // release path), clearing the confirmation.
  const cancel = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Cancel')!;
  expect(cancel.disabled).toBe(false);
  cancel.click(); flushSync();
  expect(onclose).toHaveBeenCalledOnce();
});
it('portal#2205: a failed redirect speaks redirect-specific copy linking the roster, never Reload-the-page', async () => {
  open(); await tick(); await check();
  navigationHooks.onGoto = async () => { throw new Error('navigation unavailable'); };
  await submitEnhancedWithRawResult(form(), { type: 'redirect', status: 303, location: '/app/apps/app-one?tab=staff' }); flushSync(); await tick();
  const alert = document.querySelector('[role=alert]')!;
  expect(alert.textContent).toContain('worker was deleted');
  // The worker's own URL stops resolving once it is deleted, so the
  // roster-refresh sentence ("Reload the page") is a dead end here (Gino F2):
  // the failure names the roster and links exactly where the redirect was
  // carrying the reader.
  expect(alert.textContent).not.toContain('Reload the page');
  const link = alert.querySelector('a');
  expect(link?.getAttribute('href')).toBe('/app/apps/app-one?tab=staff');
  expect(link?.textContent).toContain('roster');
});
it('portal#2227: an uncertain answer latches Submit — a retry may re-post a committed delete; only Cancel/Escape release', async () => {
  const { onclose } = open(); await tick(); await check();
  await submitEnhancedWithRawResult(form(), {
    type: 'failure', status: 502,
    data: { deleteWorkerResult: { ok: false, workerRef: 'one', code: null, uncertain: true, message: 'The delete may have succeeded. Reload to see the current state.' } },
  }); flushSync(); await tick();
  // The reload-first sentence is shown, and the naive-retry hazard is closed:
  // the outcome is unknown, so Submit must NOT come back (a retry would
  // re-post a delete that may already have committed and read
  // WORKER_NOT_FOUND as a refusal). Same latch shape as the redirect leg.
  expect(document.querySelector('[role=alert]')?.textContent).toContain('may have succeeded');
  expect(document.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  expect((await submitEnhanced(form())).cancelled).toBe(true);
  // The modal is not a trap: Cancel stays enabled and closes.
  const cancel = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Cancel')!;
  expect(cancel.disabled).toBe(false);
  cancel.click(); flushSync();
  expect(onclose).toHaveBeenCalledOnce();
});
it('portal#2260 F1: a transport-level error — no answer at all — latches Submit like any unknown outcome', async () => {
  const { onclose } = open(); await tick(); await check();
  // The browser-to-portal fetch itself died (use:enhance hands the callback
  // a bare `error` result with no data): the portal may have committed the
  // delete before the response was lost, so this is the same hazard the PR
  // names — Submit must not come back offering the naive retry that would
  // read WORKER_NOT_FOUND as a refusal.
  await submitEnhancedWithRawResult(form(), { type: 'error', status: 500, error: new Error('fetch died') }); flushSync(); await tick();
  expect(document.querySelector('[role=alert]')?.textContent).toContain('may have succeeded');
  expect(document.querySelector('[role=status]')?.textContent ?? '').not.toContain('Deleting the selected worker');
  expect(document.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  expect((await submitEnhanced(form())).cancelled).toBe(true);
  const cancel = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Cancel')!;
  expect(cancel.disabled).toBe(false);
  cancel.click(); flushSync();
  expect(onclose).toHaveBeenCalledOnce();
});
it('portal#2260 F3: an uncertain answer best-effort refreshes so the page resolves the unknown itself', async () => {
  open(); await tick(); await check();
  await submitEnhancedWithRawResult(form(), {
    type: 'failure', status: 502,
    data: { deleteWorkerResult: { ok: false, workerRef: 'one', code: null, uncertain: true, message: 'The delete may have succeeded. Reload to see the current state.' } },
  }); flushSync(); await tick();
  // Without this, Cancel unmounts the dialog onto a roster that still shows
  // the row, and Delete on that stale row mounts a fresh dialog with Submit
  // live — the retry hazard two clicks away. An authoritative re-read
  // removes the row if the delete committed; if it did not, the row stays
  // and the reader can safely retry.
  expect(navigationCalls.some(c => c.fn === 'invalidateAll')).toBe(true);
});
it('portal#2260 F3: a failed best-effort refresh cannot unlatch Submit or leak the refresh error', async () => {
  open(); await tick(); await check();
  navigationHooks.onInvalidateAll = async () => { throw new Error('refresh unavailable'); };
  await submitEnhancedWithRawResult(form(), {
    type: 'failure', status: 502,
    data: { deleteWorkerResult: { ok: false, workerRef: 'one', code: null, uncertain: true, message: 'The delete may have succeeded. Reload to see the current state.' } },
  }); flushSync(); await tick();
  expect(document.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  expect(document.querySelector('[role=alert]')?.textContent).toContain('may have succeeded');
  expect(document.body.textContent).not.toContain('refresh unavailable');
});
it('portal#2260 F4: a disabled Submit carries its reason programmatically, in field order', async () => {
  open(); await tick();
  // Unmet attestation is the reason while the box is unchecked…
  const submitButton = document.querySelector<HTMLButtonElement>('button[type=submit]')!;
  expect(submitButton.disabled).toBe(true);
  const uncheckedReason = submitButton.getAttribute('aria-describedby');
  expect(uncheckedReason).toBeTruthy();
  expect(document.getElementById(uncheckedReason!)?.textContent).toContain('attestation');
  await check();
  // …and the link is gone once the requirement is met and nothing else blocks.
  expect(submitButton.getAttribute('aria-describedby')).toBeNull();
  // An uncertain answer latches with the paused reason, linked the same way.
  await submitEnhancedWithRawResult(form(), {
    type: 'failure', status: 502,
    data: { deleteWorkerResult: { ok: false, workerRef: 'one', code: null, uncertain: true, message: 'The delete may have succeeded. Reload to see the current state.' } },
  }); flushSync(); await tick();
  expect(submitButton.disabled).toBe(true);
  const pausedReason = submitButton.getAttribute('aria-describedby');
  expect(pausedReason).toBeTruthy();
  expect(document.getElementById(pausedReason!)?.textContent).toContain('paused');
  // The redirect-failure leg (deleted latch) keeps speaking through its own
  // failure text, not the paused reason.
  expect(document.getElementById(pausedReason!)?.textContent).not.toContain('worker was deleted');
});
