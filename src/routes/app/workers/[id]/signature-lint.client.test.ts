import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, wait } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { updateSignatureFormId, updateSignatureSchema } from './schema';
import Section from './WorkerSignatureSection.svelte';

const mounted: (() => void)[] = [];
afterEach(() => { mounted.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); resetStubPage(); });
beforeEach(() => setStubPage('https://example.test/app/workers/a?tab=briefing', { id: 'a' }));
const item = (workerField: string | null, kind = 'WORKER_LINK_MISSING') => ({ kind, workerField });
const page = (items: ReturnType<typeof item>[], total = items.length, nextCursor: string | null = null) => ({ items, total, nextCursor });
const response = (value: unknown, ok = true, workerId = 'a') => ({ ok, json: async () => ({ workerId, page: value }) });
async function settle() { await wait(0); await tick(4); flushSync(); }
async function open(signature: string | null = 'signature', trailer: string | null = 'trailer', workerId = 'a') {
  const initialForm = await superValidate({ signature: signature ?? '', trailer: trailer ?? '', signatureBase: signature ?? '', trailerBase: trailer ?? '' }, zod4(updateSignatureSchema), { errors: false, id: updateSignatureFormId(workerId) });
  const props = reactiveProps({ workerId, signature, trailer, retired: false, initialForm, actionResult: undefined });
  const m = mountComponent(Section as never, props as never); mounted.push(m.unmount); await settle();
  return { root: m.target, props, unmount: m.unmount };
}
function type(root: HTMLElement, value: string) { const el = root.querySelector<HTMLTextAreaElement>('[name=signature]')!; el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }
async function save(root: HTMLElement, success = true) {
  const form = root.querySelector<HTMLFormElement>('form')!;
  const f = await superValidate(new FormData(form), zod4(updateSignatureSchema));
  f.id = form.getAttribute('data-superform-id')!;
  f.message = { type: success ? 'success' : 'error', text: success ? 'Saved.' : 'Refused.' };
  await submitEnhancedWithResult(form, { type: success ? 'success' : 'failure', status: success ? 200 : 403, data: { form: f } });
  await settle();
}
const advice = (root: HTMLElement, field: string) => root.querySelector(`[data-signature-lint-field="${field}"]`);

describe('portal#1685 saved signature/trailer link advice', () => {
  it.each([['signature'], ['trailer'], ['signature', 'trailer']])('places %j beside the matching saved field', async (...fields) => {
    const names = fields.filter(x => typeof x === 'string') as string[];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(page(names.map(f => item(f))))));
    const { root } = await open();
    for (const f of ['signature', 'trailer']) {
      expect(Boolean(advice(root, f)?.textContent)).toBe(names.includes(f));
      if (names.includes(f)) expect(root.querySelector(`[name=${f}]`)?.parentElement?.contains(advice(root, f))).toBe(true);
    }
    expect(root.textContent).toContain('saved');
    if (names.includes('signature')) expect(advice(root, 'signature')?.textContent).toContain('posts and messages');
    if (names.includes('trailer')) expect(advice(root, 'trailer')?.textContent).toContain('commits');
    expect(root.textContent).toContain('{{worker.url}}');
    expect(root.textContent).not.toContain('must contain');
  });
  it('shows refresh guidance immediately and the approved zero copy after a complete successful saved read', async () => {
    let release!: (r: unknown) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise(r => release = r)));
    const { root } = await open();
    const clear = 'No worker-link warnings on the saved values.';
    expect(root.textContent).not.toContain(clear);
    expect(root.textContent).toContain('Saved-value advice refreshes after a successful save.');
    release(response(page([]))); await settle();
    expect(root.querySelector('[data-signature-lint]')?.textContent).toContain(clear);
    type(root, 'unsaved draft without a link');
    expect(root.textContent).toContain(clear);
  });
  it.each(['null', 'transport', 'failed-http', 'wrong-worker', 'partial', 'partial-count', 'warning', 'masked', 'one-masked', 'trailer-masked'])('never gives an all-clear for %s', async mode => {
    const fetcher = vi.fn().mockResolvedValue(response(page([])));
    if (mode === 'null') fetcher.mockResolvedValue(response(null));
    if (mode === 'transport') fetcher.mockRejectedValue(new Error('offline'));
    if (mode === 'failed-http') fetcher.mockResolvedValue(response(page([]), false));
    if (mode === 'wrong-worker') fetcher.mockResolvedValue(response(page([]), true, 'b'));
    if (mode === 'partial') fetcher.mockResolvedValue(response(page([], 0, 'next')));
    if (mode === 'partial-count') fetcher.mockResolvedValue(response(page([], 1)));
    if (mode === 'warning') fetcher.mockResolvedValue(response(page([item('signature')])));
    vi.stubGlobal('fetch', fetcher);
    const { root } = await open(mode === 'masked' || mode === 'one-masked' ? null : 'signature', mode === 'masked' || mode === 'trailer-masked' ? null : 'trailer');
    expect(root.textContent).not.toContain('No worker-link warnings on the saved values.');
    if (mode === 'null') {
      const retry = [...root.querySelectorAll('button')].find(b => b.textContent === 'Retry')!;
      expect(retry.classList.contains('pointer-coarse:min-h-11')).toBe(true);
      expect(retry.classList.contains('pointer-coarse:min-w-11')).toBe(true);
    }
  });
  it('withdraws an old all-clear while a successful save refresh is unread, then shows the fresh result', async () => {
    let release!: (r: unknown) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(response(page([]))).mockImplementationOnce(() => new Promise(r => release = r));
    vi.stubGlobal('fetch', fetcher);
    const { root } = await open();
    const clear = 'No worker-link warnings on the saved values.';
    expect(root.textContent).toContain(clear);
    type(root, 'new signature without its worker link'); await save(root);
    expect(root.textContent).toContain('Saved.');
    expect(root.querySelector('[data-signature-lint]')?.getAttribute('aria-busy')).toBe('true');
    expect(root.textContent).not.toContain(clear);
    release(response(page([item('signature')]))); await settle();
    expect(advice(root, 'signature')).not.toBeNull(); expect(root.textContent).not.toContain(clear);
    fetcher.mockImplementationOnce(() => new Promise(r => release = r));
    type(root, 'now contains {{worker.url}}'); await save(root);
    expect(root.textContent).not.toContain(clear);
    release(response(page([]))); await settle();
    expect(root.textContent).toContain(clear);
  });
  it('does not explain a successful-save refresh to a retired worker with no Save', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(page([]))));
    const { root, props } = await open(); props.retired = true; await settle();
    expect(root.querySelector('[type=submit]')).toBeNull();
    expect(root.textContent).not.toContain('Saved-value advice refreshes after a successful save.');
    props.retired = false; await settle();
    expect(root.textContent).toContain('Saved-value advice refreshes after a successful save.');
  });
  it('uses the server zero result even for a literal URL, not a client variable matcher', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(page([]))));
    const { root } = await open('https://example.test/app/u/hrn:worker:example.com:team:a');
    expect(root.querySelector('[data-signature-lint-field]')).toBeNull();
    expect(root.textContent).not.toContain('Couldn’t check');
  });
  it.each(['null', 'transport', 'older-schema'])('keeps %s unavailable separate from zero and offers read-only Retry', async mode => {
    const fetcher = vi.fn().mockResolvedValue(response(null));
    if (mode === 'transport') fetcher.mockRejectedValue(new Error('socket'));
    if (mode === 'older-schema') fetcher.mockResolvedValue(response(null, false));
    vi.stubGlobal('fetch', fetcher);
    const { root } = await open();
    expect(root.textContent).toContain('Couldn’t check the worker link.');
    type(root, 'edited');
    expect(root.querySelector<HTMLButtonElement>('[type=submit]')?.disabled).toBe(false);
    fetcher.mockResolvedValue(response(page([])));
    [...root.querySelectorAll('button')].find(b => b.textContent === 'Retry')!.click(); await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]?.method ?? 'GET').toBe('GET');
    expect(root.textContent).not.toContain('Couldn’t check');
    // #1852: the unavailable state does not merely clear. A successful Retry that
    // reads zero warnings renders the server-zero copy, not an empty region.
    expect(root.querySelector('[data-signature-lint]')?.textContent).toContain('No worker-link warnings on the saved values.');
    expect(document.activeElement).toBe(root.querySelector('[data-signature-lint]'));
  });
  it('shows partial count and neutral advice for unknown kinds/fields, never backend prose', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(page([item('signature', 'NEW_KIND'), item('unknown')], 3, 'next'))));
    const { root } = await open();
    expect(root.textContent).toContain('2 of 3');
    expect(root.textContent).toContain('The rest isn’t shown.');
    expect(root.textContent).toContain('The worker link check found something to review.');
    expect(root.querySelector('[data-signature-lint-field]')).toBeNull();
    expect(root.textContent).not.toContain('NEW_KIND');
  });
  it('makes no lint request or claim when both templates are masked', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { root } = await open(null, null);
    expect(fetcher).not.toHaveBeenCalled();
    expect(root.querySelector('[data-signature-lint]')).toBeNull();
    expect(root.querySelector('form')).toBeNull();
  });
  it('refreshes only on successful save, and a failed refresh preserves success and draft', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(page([item('signature')]))).mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    const { root } = await open(); type(root, 'edited with {{worker.url}}');
    await save(root, false);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(advice(root, 'signature')).not.toBeNull();
    await save(root);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(root.textContent).toContain('Saved.'); expect(root.textContent).toContain('Couldn’t check');
    expect(root.querySelector<HTMLTextAreaElement>('[name=signature]')?.value).toBe('edited with {{worker.url}}');
  });
  it('drops late A after navigation to B in the same component', async () => {
    let release!: (r: unknown) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise(r => release = r)).mockResolvedValueOnce(response(page([item('trailer')]), true, 'b'));
    vi.stubGlobal('fetch', fetcher);
    const { root, props } = await open(); props.workerId = 'b'; await settle();
    release(response(page([item('signature')]))); await settle();
    expect(advice(root, 'signature')).toBeNull(); expect(advice(root, 'trailer')).not.toBeNull();
  });
  it('drops the first save lint after the second save lint', async () => {
    let first!: (r: unknown) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(response(page([]))).mockImplementationOnce(() => new Promise(r => first = r)).mockResolvedValueOnce(response(page([item('trailer')])));
    vi.stubGlobal('fetch', fetcher);
    const { root } = await open(); type(root, 'save one'); await save(root); type(root, 'save two'); await save(root);
    expect(fetcher).toHaveBeenCalledTimes(3);
    first(response(page([item('signature')]))); await settle();
    expect(advice(root, 'signature')).toBeNull(); expect(advice(root, 'trailer')).not.toBeNull();
  });
  it('keeps Retry focused and ignores a second activation while its read is pending', async () => {
    let finish!: (r: unknown) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(response(null)).mockImplementationOnce(() => new Promise(r => finish = r));
    vi.stubGlobal('fetch', fetcher);
    const { root } = await open();
    const retry = [...root.querySelectorAll('button')].find(b => b.textContent === 'Retry')!;
    retry.focus(); retry.click(); await settle();
    expect(retry.disabled).toBe(false);
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(retry);
    retry.click(); await settle(); expect(fetcher).toHaveBeenCalledTimes(2);
    finish(response(null)); await settle();
    expect(retry.getAttribute('aria-disabled')).toBe('false');
    expect(document.activeElement).toBe(retry);
    expect(root.textContent).toContain('Couldn’t check');
  });
  it.each(['null', 'transport', 'failed-http'])('announces every failed Retry in the same mounted region: %s (#1918)', async mode => {
    const fetcher = vi.fn().mockResolvedValue(response(null));
    if (mode === 'transport') fetcher.mockRejectedValue(new Error('offline'));
    if (mode === 'failed-http') fetcher.mockResolvedValue(response(null, false));
    vi.stubGlobal('fetch', fetcher);
    const { root } = await open();
    const region = root.querySelector<HTMLElement>('[data-signature-lint]')!;
    const retry = region.querySelector<HTMLButtonElement>('button')!;
    const zero = 'No worker-link warnings on the saved values.';
    let previous = region.textContent!.trim();
    for (let attempt = 1; attempt <= 3; attempt++) {
      retry.focus(); retry.click(); await settle();
      expect(root.querySelector('[data-signature-lint]')).toBe(region);
      expect(root.querySelectorAll('[data-signature-lint]')).toHaveLength(1);
      expect(region.getAttribute('aria-live')).toBe('polite');
      expect(region.getAttribute('aria-atomic')).toBe('true');
      expect(region.getAttribute('aria-busy')).toBe('false');
      expect(region.textContent!.trim()).not.toBe(previous);
      expect(region.textContent).not.toContain(zero);
      expect(document.activeElement).toBe(retry);
      previous = region.textContent!.trim();
    }
    expect(fetcher).toHaveBeenCalledTimes(4);
    fetcher.mockResolvedValue(response(page([])));
    retry.click(); await settle();
    expect(root.querySelector('[data-signature-lint]')).toBe(region);
    expect(region.textContent).toContain(zero);
    expect(document.activeElement).toBe(region);
  });

  it('retains the same live advice nodes through a successful save and identical lint refresh', async () => {
    let finish!: (r: unknown) => void;
    const warnings = page([item('signature'), item('trailer')]);
    const fetcher = vi.fn().mockResolvedValueOnce(response(warnings)).mockImplementationOnce(() => new Promise(r => finish = r));
    vi.stubGlobal('fetch', fetcher);
    const { root } = await open();
    const signature = advice(root, 'signature'), trailer = advice(root, 'trailer');
    type(root, 'edited draft'); await save(root);
    expect(root.textContent).toContain('Saved.');
    expect(advice(root, 'signature')).toBe(signature);
    expect(advice(root, 'trailer')).toBe(trailer);
    finish(response(warnings)); await settle();
    expect(advice(root, 'signature')).toBe(signature);
    expect(advice(root, 'trailer')).toBe(trailer);
  });

  it('keeps advice mounted when the loader replaces the same readable worker after save', async () => {
    const warnings = page([item('signature')]);
    let release!: (value: ReturnType<typeof response>) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(response(warnings)).mockImplementation(() => new Promise(r => release = r));
    vi.stubGlobal('fetch', fetcher);
    const worker = reactiveProps({ value: { id: 'a', signature: 'signature', trailer: 'trailer' } });
    const initialForm = await superValidate({ signature: 'signature', trailer: 'trailer', signatureBase: 'signature', trailerBase: 'trailer' }, zod4(updateSignatureSchema), { errors: false, id: updateSignatureFormId('a') });
    const m = mountComponent(Section as never, { get workerId() { return worker.value.id; }, get signature() { return worker.value.signature; }, get trailer() { return worker.value.trailer; }, initialForm, retired: false, actionResult: undefined } as never);
    mounted.push(m.unmount); await settle();
    const root = m.target;
    const original = advice(root, 'signature');
    type(root, 'changed saved signature');
    await save(root);
    // The real enhanced action invalidates the loader as well as calling onUpdated.
    worker.value = { id: 'a', signature: 'changed saved signature', trailer: 'trailer' };
    await settle();
    expect(advice(root, 'signature')).toBe(original);
    expect(fetcher).toHaveBeenCalledTimes(2);
    release(response(warnings)); await settle();
    expect(advice(root, 'signature')).toBe(original);
    // A genuinely different worker still starts a new window and clears A's advice.
    worker.value = { id: 'b', signature: 'other signature', trailer: 'other trailer' };
    await settle();
    expect(advice(root, 'signature')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
    release(response(warnings, true, 'b')); await settle();
    expect(advice(root, 'signature')).not.toBeNull();
    expect(advice(root, 'signature')).not.toBe(original);
  });

  // #1852 — late in-flight results after a TRUE worker change (the loader hands
  // this same mounted section a different worker: id, signature and trailer all
  // change), not only the id-only navigation pinned above.
  describe('#1852 late in-flight reads', () => {
    async function openReplaceable(fetcher: ReturnType<typeof vi.fn>) {
      vi.stubGlobal('fetch', fetcher);
      const worker = reactiveProps({ value: { id: 'a', signature: 'sig-a', trailer: 'trl-a' } });
      const initialForm = await superValidate({ signature: 'sig-a', trailer: 'trl-a', signatureBase: 'sig-a', trailerBase: 'trl-a' }, zod4(updateSignatureSchema), { errors: false, id: updateSignatureFormId('a') });
      const m = mountComponent(Section as never, { get workerId() { return worker.value.id; }, get signature() { return worker.value.signature; }, get trailer() { return worker.value.trailer; }, initialForm, retired: false, actionResult: undefined } as never);
      mounted.push(m.unmount); await settle();
      return { root: m.target, worker };
    }
    const pendingFetcher = () => { const pending: ((r: unknown) => void)[] = []; return { pending, fetcher: vi.fn().mockImplementation(() => new Promise<unknown>(r => { pending.push(r); })) }; };

    it('drops worker A\'s late result after the loader replaces it with worker B', async () => {
      const { pending, fetcher } = pendingFetcher();
      const { root, worker } = await openReplaceable(fetcher);
      worker.value = { id: 'b', signature: 'sig-b', trailer: 'trl-b' }; await settle();
      expect(fetcher).toHaveBeenCalledTimes(2);
      pending[0](response(page([item('signature')]), true, 'a')); await settle();
      expect(advice(root, 'signature')).toBeNull();
      expect(root.textContent).not.toContain('No worker-link warnings on the saved values.');
      pending[1](response(page([item('trailer')]), true, 'b')); await settle();
      expect(advice(root, 'trailer')).not.toBeNull(); expect(advice(root, 'signature')).toBeNull();
    });
    it('drops the first read of A after A -> B -> A, when the worker id matches again', async () => {
      const { pending, fetcher } = pendingFetcher();
      const { root, worker } = await openReplaceable(fetcher);
      worker.value = { id: 'b', signature: 'sig-b', trailer: 'trl-b' }; await settle();
      worker.value = { id: 'a', signature: 'sig-a', trailer: 'trl-a' }; await settle();
      expect(fetcher).toHaveBeenCalledTimes(3);
      pending[2](response(page([]), true, 'a')); await settle();
      expect(root.querySelector('[data-signature-lint]')?.textContent).toContain('No worker-link warnings on the saved values.');
      // Same worker id as the live one, so only the read epoch can tell it is stale.
      pending[0](response(page([item('signature')]), true, 'a')); await settle();
      expect(advice(root, 'signature')).toBeNull();
      expect(root.querySelector('[data-signature-lint]')?.textContent).toContain('No worker-link warnings on the saved values.');
    });
  });

  // #1852 — which path fired a second fetch. The post-save re-read is the ONLY
  // trigger for a same-worker refresh; a loader replacement does not re-lint.
  describe('#1852 second-fetch attribution', () => {
    it('a loader replacement of the same worker alone does not re-read; a successful save does exactly once', async () => {
      const fetcher = vi.fn().mockResolvedValue(response(page([item('signature')])));
      vi.stubGlobal('fetch', fetcher);
      const worker = reactiveProps({ value: { id: 'a', signature: 'signature', trailer: 'trailer' } });
      const initialForm = await superValidate({ signature: 'signature', trailer: 'trailer', signatureBase: 'signature', trailerBase: 'trailer' }, zod4(updateSignatureSchema), { errors: false, id: updateSignatureFormId('a') });
      const m = mountComponent(Section as never, { get workerId() { return worker.value.id; }, get signature() { return worker.value.signature; }, get trailer() { return worker.value.trailer; }, initialForm, retired: false, actionResult: undefined } as never);
      mounted.push(m.unmount); await settle();
      const root = m.target;
      expect(fetcher).toHaveBeenCalledTimes(1);
      // Loader replacement alone (a non-save invalidation): new object, same id.
      worker.value = { id: 'a', signature: 'edited elsewhere', trailer: 'trailer' }; await settle();
      expect(fetcher).toHaveBeenCalledTimes(1);
      // The save path, without a loader replacement, is the one that re-reads.
      type(root, 'saved here'); await save(root);
      expect(fetcher).toHaveBeenCalledTimes(2);
      // A replacement that follows the save adds no third read.
      worker.value = { id: 'a', signature: 'saved here', trailer: 'trailer' }; await settle();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls.every(c => String(c[0]) === '/app/workers/a/signature-lint')).toBe(true);
    });
  });
});
