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
it('rejects a mismatched worker response without closing, refreshing or changing the target', async () => {
  const { props, onclose } = open(); await tick(); await check();
  const selected = props.worker;
  const pending = await submitEnhancedDeferred(form()); flushSync(); await tick();
  expect(document.querySelector('[role=status]')?.textContent).toContain('Deleting the selected worker');
  await pending.finish(result(true, 'other-worker')); flushSync(); await tick();
  expect(document.querySelector('[role=alert]')?.textContent).toBe('Deletion was not confirmed. Refresh the roster before trying again.');
  expect(document.querySelector('[role=status]')).toBeNull();
  expect(document.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
  expect(document.querySelector<HTMLDialogElement>('dialog')!.open).toBe(true);
  expect(onclose).not.toHaveBeenCalled(); expect(navigationCalls).toHaveLength(0);
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
it('portal#2205: if following the delete redirect fails, the dialog turns closable and says so', async () => {
  const { onclose } = open(); await tick(); await check();
  navigationHooks.onGoto = async () => { throw new Error('navigation unavailable'); };
  await submitEnhancedWithRawResult(form(), { type: 'redirect', status: 303, location: '/app/apps/app-one?tab=staff' }); flushSync(); await tick();
  expect(document.querySelector('[role=alert]')?.textContent).toContain('worker was deleted');
  // pending was released: a retry is possible instead of a trapped modal.
  expect(document.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
  expect(document.querySelector('[role=status]')).toBeNull();
  expect(onclose).not.toHaveBeenCalled();
});
