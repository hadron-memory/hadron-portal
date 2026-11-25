import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import { navigationGuards, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import TemplatesManager from './TemplatesManager.svelte';
import type { Template, Rule } from '$lib/memory-config/types';
const template: Template = { id: 't1', name: 'baseline', description: 'Test rulebook', required: true, revision: 9, rules: [] };
const fetcher = vi.fn();
let cleanup: (() => void)[] = [];
function mount(readOnly = false, canManage = true, initial = [template]) {
  const m = mountComponent(TemplatesManager, { initial, ownerType: 'USER' as const, ownerRef: 'u1', readOnly, canManage, memories: [{ id: 'm1', name: 'My memory', urn: 'hrn:mem:acme.com:memory' }], memoriesFailed: false });
  cleanup.push(m.unmount); return m;
}
function button(root: HTMLElement, text: string) { return [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!; }
function search(root: HTMLElement, label: string, value: string) {
  const input = root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
  return input;
}
beforeEach(() => { localStorage.clear(); resetNavigationGuards(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher); vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup.splice(0).forEach(f => f()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('heading levels inside a titled section (portal#2612 P3)', () => {
  const levels = (root: HTMLElement) => [...root.querySelectorAll('h1,h2,h3,h4')].map((h) => h.tagName.toLowerCase());
  async function toPreview(embedded: boolean) {
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ dryRun: true, required: false, warnings: [], tasks: [] }) });
    const m = mountComponent(TemplatesManager, { initial: [template], ownerType: 'USER' as const, ownerRef: 'u1', readOnly: false, canManage: true, embedded, memories: [{ id: 'm1', name: 'My memory', urn: 'hrn:mem:example.com:my-memory' }], memoriesFailed: false } as never);
    cleanup.push(m.unmount);
    button(m.target, 'Apply to a memory…').click(); flushSync();
    return m;
  }
  it('embedded: the apply panel sits one level below the section title, never beside it', async () => {
    const m = await toPreview(true);
    expect(levels(m.target)).not.toContain('h1');
    expect(levels(m.target)).not.toContain('h2');
    expect(levels(m.target)).toContain('h3');
  });
  it('standalone: the page keeps its own h1 and h2', async () => {
    const m = await toPreview(false);
    expect(levels(m.target)).toContain('h1');
    expect(levels(m.target)).toContain('h2');
  });
});
describe('template management states', () => {
  it('impersonation and non-manager views have no mutation or apply controls', () => {
    for (const [readOnly, canManage] of [[true, true], [false, false]]) {
      const m = mount(readOnly, canManage);
      for (const name of ['Create template', 'Edit', 'Delete', 'Apply to a memory…']) expect(button(m.target, name)).toBeUndefined();
    }
  });
  it('retains template input on CONFLICT and uses expected revision', async () => {
    fetcher.mockResolvedValue({ ok: false, json: async () => ({ code: 'CONFLICT', error: 'The template changed.' }) });
    const m = mount(); button(m.target, 'Edit').click(); flushSync();
    const input = m.target.querySelector<HTMLInputElement>('input[maxlength="64"]')!;
    input.value = 'my-retained-name'; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    button(m.target, 'Save').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('The template changed.'); });
    expect(m.target.querySelector('input[maxlength="64"]')).toBe(input);
    expect(input.value).toBe('my-retained-name');
    const save = button(m.target, 'Save');
    const alert = m.target.querySelector('[role=alert]')!;
    expect(alert.nextElementSibling?.textContent).toContain('Reload template');
    expect(alert.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const sent = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(sent).toMatchObject({ op: 'update', ref: 't1', revision: 9, input: { name: 'my-retained-name' } });
    // required is sent only when it changed (portal#1743): the server re-validates references whenever it is present.
    expect((sent as { input: object }).input).not.toHaveProperty('required');
    expect(sent.input).not.toHaveProperty('rules');
  });
  it('states required-template lock consequences before saving, without disabling Save', () => {
    const m = mount(); button(m.target, 'Edit').click(); flushSync();
    expect(m.target.textContent).toContain('Applied rules arrive locked');
    expect(m.target.textContent).toContain('only an org admin can unlock');
    expect(button(m.target, 'Save').disabled).toBe(false);
  });
  it('previews without writes, applies the preview revision, and retires a stale preview on CONFLICT', async () => {
    const preview = { memoryId: 'm1', templateRevision: 9, required: true, dryRun: true, entries: [{ role: 'review', outcome: 'APPLIED' }], warnings: [] };
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ value: preview }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'CONFLICT', error: 'revision mismatch' }) });
    const m = mount(); button(m.target, 'Apply to a memory…').click(); flushSync();
    expect(button(m.target, 'Apply and lock rules')).toBeUndefined();
    button(m.target, 'Choose memory…').click(); flushSync();
    const select = m.target.querySelector<HTMLButtonElement>('button[aria-label="Select My memory"]')!;
    expect(select).not.toBeNull(); select.click(); flushSync();
    button(m.target, 'Preview').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('Preview: nothing has been changed'); });
    expect(m.target.textContent).toContain('Will be added');
    expect(m.target.textContent).toContain('Applied rules arrive locked');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ kind: 'apply', op: 'preview', ref: 't1', memoryRef: 'm1' });
    button(m.target, 'Apply and lock rules').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('This template changed since the preview.'); });
    expect(button(m.target, 'Apply and lock rules').disabled).toBe(true);
    expect(button(m.target, 'Preview again')).toBeDefined();
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ op: 'apply', revision: 9 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('labels each draft reference and setting separately', () => {
    const r = { role: 'review', enabled: true, strictSubRoles: false, writers: 'ADMIN', validateBy: 'AGENT', authorTask: null, authorTaskState: 'NONE', validationTask: null, validationTaskState: 'NONE', descriptionNode: null, descriptionNodeState: 'NONE' } as Rule;
    const m = mount(false, true, [{ ...template, rules: [r] }]); button(m.target, 'Edit').click(); flushSync();
    const form = m.target.querySelector('[aria-label="Template editor"]')!;
    for (const text of ['Author task', 'Validation task', 'Description node', 'Writers: ADMIN', 'Validate by: AGENT']) expect(form.textContent).toContain(text);
  });

  it('distinguishes a successful delete from a failed refresh and never replays it', async () => {
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({}) }).mockRejectedValueOnce(new Error('offline'));
    const m = mount(); button(m.target, 'Delete').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('Deleted, but the templates could not be reloaded. Reload before another change.'); });
    expect(button(m.target, 'Delete')).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).op).toBe('delete');
    expect(JSON.parse(fetcher.mock.calls[1][1].body).op).toBe('read');
  });
  it('names a skipped conflict separately from an existing-rule skip', async () => {
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { memoryId: 'm1', templateRevision: 9, required: false, dryRun: true, entries: [{ role: 'review', outcome: 'SKIPPED_CONFLICT' }], warnings: [] } }) });
    const m = mount(); button(m.target, 'Apply to a memory…').click(); flushSync();
    button(m.target, 'Choose memory…').click(); flushSync();
    m.target.querySelector<HTMLButtonElement>('button[aria-label="Select My memory"]')!.click(); flushSync(); button(m.target, 'Preview').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('Skipped: conflict'); });
    expect(m.target.textContent).not.toContain('Skipped: a rule already exists');
  });
  it('asks before leaving while a preview is pending', async () => {
    let settle!: (value: unknown) => void;
    fetcher.mockReturnValueOnce(new Promise(resolve => { settle = resolve; }));
    const m = mount(); button(m.target, 'Apply to a memory…').click(); flushSync();
    button(m.target, 'Choose memory…').click(); flushSync(); m.target.querySelector<HTMLButtonElement>('button[aria-label="Select My memory"]')!.click(); flushSync();
    button(m.target, 'Preview').click(); flushSync(); vi.mocked(window.confirm).mockReturnValue(false);
    const cancel = vi.fn(); const guard = navigationGuards.find(g => g.fn === 'beforeNavigate')!.callback as (event: { cancel: () => void }) => void;
    try { guard({ cancel }); expect(cancel).toHaveBeenCalledOnce(); }
    finally { settle({ ok: true, json: async () => ({ value: { memoryId: 'm1', templateRevision: 9, required: false, dryRun: true, entries: [], warnings: [] } }) }); await vi.waitFor(() => { flushSync(); expect(button(m.target, 'Preview').disabled).toBe(false); }); }
  });

});

describe('#1764 less-visible task warning on single apply', () => {
  const urn = 'hrn:node:acme.com:tasks:review-author';
  const warn = { code: 'TASK_LESS_VISIBLE', role: 'review', field: 'authorTask', taskUrn: urn, taskState: 'OK' };
  const answer = (dryRun: boolean, warnings: unknown[]) => ({ ok: true, json: async () => ({ value: { memoryId: 'm1', templateRevision: 9, required: false, dryRun, entries: [{ role: 'review', outcome: 'APPLIED' }], warnings } }) });
  function pickMemory(root: HTMLElement) {
    button(root, 'Apply to a memory…').click(); flushSync();
    button(root, 'Choose memory…').click(); flushSync();
    root.querySelector<HTMLButtonElement>('button[aria-label="Select My memory"]')!.click(); flushSync();
  }
  it('preview and real apply show the same plain copy, with the URN, and never the raw code', async () => {
    fetcher.mockResolvedValueOnce(answer(true, [warn])).mockResolvedValueOnce(answer(false, [warn]));
    const m = mount(false, true, [{ ...template, required: false }]); pickMemory(m.target);
    const feedback = m.target.querySelector('[data-apply-feedback]');
    expect(feedback).not.toBeNull(); expect(feedback?.textContent).not.toContain('author task');
    button(m.target, 'Preview').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('Preview: nothing has been changed'); });
    const previewText = [...m.target.querySelectorAll('[data-task-warning]')].map(n => n.textContent);
    expect(feedback?.textContent).toContain('author task');
    expect(previewText.length).toBe(1); expect(previewText[0]).toContain('author task'); expect(previewText[0]!.replace(/\s/g, '')).toContain(urn);
    expect(m.target.textContent).not.toContain('TASK_LESS_VISIBLE');
    // A warning on the preview does not block the apply.
    const applyButton = [...m.target.querySelectorAll('button')].find(b => /^Apply/.test(b.textContent?.trim() ?? '') && !/Apply to/.test(b.textContent ?? ''))!;
    expect(applyButton.disabled).toBe(false);
    applyButton.click();
    await vi.waitFor(() => { flushSync(); expect(m.target.textContent).not.toContain('Preview: nothing has been changed'); });
    const appliedText = [...m.target.querySelectorAll('[data-task-warning]')].map(n => n.textContent);
    expect(appliedText).toEqual(previewText);
  });
  it('shows nothing for an empty list', async () => {
    fetcher.mockResolvedValueOnce(answer(true, []));
    const m = mount(false, true, [{ ...template, required: false }]); pickMemory(m.target);
    button(m.target, 'Preview').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('Preview: nothing has been changed'); });
    expect(m.target.querySelectorAll('[data-task-warning]').length).toBe(0);
  });
  it('normalizes malformed task references before rendering a single-apply warning', async () => {
    fetcher.mockResolvedValueOnce(answer(true, [{ ...warn, taskUrn: 7 }]));
    const m = mount(false, true, [{ ...template, required: false }]); pickMemory(m.target);
    button(m.target, 'Preview').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.querySelectorAll('[data-task-warning]').length).toBe(1); });
    expect(m.target.querySelector('[data-task-warning] code')).toBeNull();
    expect(m.target.textContent).not.toContain('>7<');
  });
  it('treats a non-array warnings answer as no renderable warnings instead of throwing', async () => {
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { memoryId: 'm1', templateRevision: 9, required: false, dryRun: true, entries: [], warnings: 'bad' } }) });
    const m = mount(false, true, [{ ...template, required: false }]); pickMemory(m.target);
    button(m.target, 'Preview').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('Preview: nothing has been changed'); });
    expect(m.target.querySelectorAll('[data-task-warning]').length).toBe(0);
  });
  it('a null field or an unknown code renders a generic line and never throws or prints the code', async () => {
    fetcher.mockResolvedValueOnce(answer(true, [{ ...warn, field: null }, { ...warn, code: 'NEW_CODE' }]));
    const m = mount(false, true, [{ ...template, required: false }]); pickMemory(m.target);
    button(m.target, 'Preview').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.querySelectorAll('[data-task-warning]').length).toBe(2); });
    expect(m.target.textContent).not.toContain('NEW_CODE'); expect(m.target.textContent).not.toContain('TASK_LESS_VISIBLE');
    expect(m.target.textContent).not.toContain(urn);
  });

});

describe('portal#1761 grid search', () => {
  it('filters template rows and restores them when cleared', () => {
    const other = { ...template, id: 't2', name: 'other', description: 'Other template', required: false };
    const m = mount(false, true, [template, other]);
    expect(m.target.querySelectorAll('tbody tr')).toHaveLength(2);
    const input = search(m.target, 'Search templates…', 'baseline');
    expect(m.target.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(m.target.querySelector('tbody')?.textContent).toContain('baseline');
    expect(m.target.querySelector('tbody')?.textContent).not.toContain('other');
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    expect(m.target.querySelectorAll('tbody tr')).toHaveLength(2);
    search(m.target, 'Search templates…', 'Yes');
    expect(m.target.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(m.target.querySelector('tbody')?.textContent).toContain('baseline');
    expect(m.target.querySelector('tbody')?.textContent).not.toContain('other');
  });

  it('filters draft rule rows and restores them when cleared', () => {
    const review = { role: 'review', enabled: true, strictSubRoles: false, writers: 'ADMIN', validateBy: 'AGENT', authorTask: null, authorTaskState: 'NONE', validationTask: null, validationTaskState: 'NONE', descriptionNode: null, descriptionNodeState: 'NONE' } as Rule;
    const publish: Rule = { ...review, role: 'publish', enabled: false, writers: 'OWNER' };
    const m = mount(false, true, [{ ...template, rules: [review, publish] }]);
    button(m.target, 'Edit').click(); flushSync();
    const form = m.target.querySelector<HTMLElement>('[aria-label="Template editor"]')!;
    expect(form.querySelectorAll('tbody tr')).toHaveLength(2);
    const input = search(form, 'Search rules…', 'review');
    expect(form.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(form.querySelector('tbody')?.textContent).toContain('review');
    expect(form.querySelector('tbody')?.textContent).not.toContain('publish');
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    expect(form.querySelectorAll('tbody tr')).toHaveLength(2);
    search(form, 'Search rules…', 'OWNER');
    expect(form.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(form.querySelector('tbody')?.textContent).toContain('publish');
    expect(form.querySelector('tbody')?.textContent).not.toContain('review');
  });

  it('filters preview rows and restores them when cleared', async () => {
    const preview = { memoryId: 'm1', templateRevision: 9, required: false, dryRun: true, entries: [{ role: 'review', outcome: 'APPLIED' }, { role: 'publish', outcome: 'SKIPPED_CONFLICT' }], warnings: [] };
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ value: preview }) });
    const m = mount(); button(m.target, 'Apply to a memory…').click(); flushSync();
    button(m.target, 'Choose memory…').click(); flushSync();
    m.target.querySelector<HTMLButtonElement>('button[aria-label="Select My memory"]')!.click(); flushSync();
    button(m.target, 'Preview').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('Preview: nothing has been changed'); });
    const input = m.target.querySelector<HTMLInputElement>('input[aria-label="Search preview…"]')!;
    const panel = input.closest('section')!;
    expect(panel.querySelectorAll('tbody tr')).toHaveLength(2);
    input.value = 'review'; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    expect(panel.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(panel.querySelector('tbody')?.textContent).toContain('review');
    expect(panel.querySelector('tbody')?.textContent).not.toContain('publish');
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    expect(panel.querySelectorAll('tbody tr')).toHaveLength(2);
    input.value = 'Will be added'; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    expect(panel.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(panel.querySelector('tbody')?.textContent).toContain('review');
    expect(panel.querySelector('tbody')?.textContent).not.toContain('publish');
  });
});
