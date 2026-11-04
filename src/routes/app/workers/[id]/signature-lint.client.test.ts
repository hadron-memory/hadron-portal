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
    expect(root.textContent).toContain('Couldn’t check');
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

});
