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
beforeEach(() => { localStorage.clear(); resetNavigationGuards(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher); vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup.splice(0).forEach(f => f()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
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
    expect(sent).toMatchObject({ op: 'update', ref: 't1', revision: 9, input: { name: 'my-retained-name', required: true } });
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
