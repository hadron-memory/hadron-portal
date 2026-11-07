import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import RulebookManager from './RulebookManager.svelte';
import type { Rule, Rulebook } from '$lib/memory-config/types';
const rule: Rule = { id: 'r1', role: 'review', revision: 7, enabled: true, strictSubRoles: true, writers: 'OWNER', validateBy: 'AGENT', locked: false, authorTask: null, authorTaskId: null, authorTaskState: 'UNREADABLE', validationTask: null, validationTaskId: null, validationTaskState: 'BROKEN', descriptionNode: null, descriptionNodeId: 'description', descriptionNodeState: 'OK' };
const book: Rulebook = { id: 'config', rules: [rule] };
const fetcher = vi.fn();
let cleanup: (() => void)[] = [];
function mount(initial: Rulebook | null, readOnly = false) {
  const props = reactiveProps({ initial, readOnly, memoryRef: 'memory', memories: [], memoriesFailed: false });
  const m = mountComponent(RulebookManager, props); cleanup.push(m.unmount); return { ...m, props };
}
const button = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;
function search(root: HTMLElement, value: string) {
  const input = root.querySelector<HTMLInputElement>('input[aria-label="Search rules…"]')!;
  input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
}
beforeEach(() => {
  localStorage.clear(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup.splice(0).forEach(f => f()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('rendered memory rule management', () => {
  it.each(['ordinary reader', 'non-manager writer', 'org admin of personal memory'])('conceals section and rulebook for %s', () => {
    const m = mount(null); expect(m.target.textContent).not.toContain('Node roles'); expect(m.target.querySelector('table')).toBeNull();
  });
  it('strict owner sees settings and explicit reference states without invented links', () => {
    const m = mount(book); const text = m.target.textContent!;
    expect(text).toContain('review'); expect(text).toContain('not supported yet; refuses every write when enabled');
    expect(text).toContain('UNREADABLE'); expect(text).toContain('BROKEN'); expect(text).toContain('no address');
    expect(m.target.querySelector('a[href*="description"]')).toBeNull();
  });
  it('impersonation renders read-only with no mutation controls, including locked rules', () => {
    const m = mount({ rules: [rule, { ...rule, id: 'locked', role: 'locked', locked: true, sourceTemplate: { id: 't', name: 'baseline', deleted: false } }] }, true);
    expect(m.target.textContent).toContain('read-only while impersonating');
    for (const name of ['Create rule', 'Edit', 'Delete', 'Unlock']) expect(button(m.target, name)).toBeUndefined();
  });
  it('locked rows offer deliberate Unlock, never Edit/Delete, and retain the server refusal', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ code: 'RULE_LOCKED', error: 'Only an org admin can unlock this rule.' }), { status: 400 }));
    const m = mount({ rules: [{ ...rule, locked: true }] });
    expect(button(m.target, 'Edit')).toBeUndefined(); expect(button(m.target, 'Delete')).toBeUndefined();
    button(m.target, 'Unlock').click(); await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('Only an org admin can unlock this rule.'); });
    expect(m.target.textContent).toContain('Only an org admin can unlock this rule.');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ op: 'unlock', ref: 'r1' });
  });
  it('keeps editor input on CONFLICT, carries expectedRevision, and warns before Save', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ code: 'CONFLICT', error: 'The rule changed.' }), { status: 409 }));
    const m = mount(book); button(m.target, 'Edit').click(); flushSync();
    const dialog = m.target.querySelector('dialog')!;
    const enabled = dialog.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[0]; enabled.click(); flushSync();
    button(dialog, 'Save').click(); await vi.waitFor(() => { flushSync(); expect(dialog.textContent).toContain('The rule changed.'); });
    expect(m.target.querySelector('dialog')).toBe(dialog);
    expect(enabled.checked).toBe(false); expect(dialog.textContent).toContain('The rule changed.');
    expect(button(dialog, 'Reload the rule (discards your changes)')).toBeDefined();
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ op: 'update', revision: 7, input: { enabled: false } });
  });
  it('shows the write-refusal warning before saving enabled OWNER / strict settings', () => {
    const m = mount(book); button(m.target, 'Edit').click(); flushSync();
    const dialog = m.target.querySelector('dialog')!;
    expect(dialog.textContent).toContain('Saving this enabled OWNER rule will refuse every write');
    expect(button(dialog, 'Save').disabled).toBe(false);
  });
  it('hides the old book when the current caller response becomes null', () => {
    const m = mount(book); expect(m.target.textContent).toContain('review');
    m.props.initial = null; flushSync();
    expect(m.target.textContent).not.toContain('review'); expect(button(m.target, 'Create rule')).toBeUndefined();
  });
  it('removes an already-open editor if this view becomes read-only', () => {
    const m = mount(book); button(m.target, 'Edit').click(); flushSync();
    expect(m.target.querySelector('dialog')).not.toBeNull();
    m.props.readOnly = true; flushSync();
    expect(m.target.querySelector('dialog')).toBeNull();
    expect(button(m.target, 'Create rule')).toBeUndefined();
  });

  it('returns focus to the invoking Edit action after Cancel', async () => {
    const m = mount(book); const edit = button(m.target, 'Edit'); edit.focus(); edit.click(); flushSync();
    const cancel = button(m.target.querySelector('dialog')!, 'Cancel'); cancel.focus(); cancel.click(); flushSync(); await tick();
    expect(document.activeElement).toBe(edit);
  });
  it('returns focus to a surviving row action after Save reload', async () => {
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({}) }).mockResolvedValueOnce({ ok: true, json: async () => ({ value: { ...book, rules: [{ ...rule, revision: 8 }] } }) });
    const m = mount(book); const edit = button(m.target, 'Edit'); edit.focus(); edit.click(); flushSync();
    const save = button(m.target.querySelector('dialog')!, 'Save'); save.focus(); save.click();
    await vi.waitFor(() => { flushSync(); expect(m.target.querySelector('dialog')).toBeNull(); expect(document.activeElement).toBe(button(m.target, 'Edit')); });
  });

  it('does not steal a newer control focus when closing the editor', async () => {
    const m = mount(book); button(m.target, 'Edit').click(); flushSync();
    const other = document.createElement('input'); document.body.append(other);
    try { other.focus(); button(m.target.querySelector('dialog')!, 'Cancel').click(); flushSync(); await tick(); expect(document.activeElement).toBe(other); }
    finally { other.remove(); }
  });

  it('uses the surviving heading if the invoking row disappears during reload', async () => {
    let finishRead!: (value: unknown) => void;
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({}) }).mockReturnValueOnce(new Promise(resolve => { finishRead = resolve; }));
    const m = mount(book); const edit = button(m.target, 'Edit'); edit.focus(); edit.click(); flushSync();
    const save = button(m.target.querySelector('dialog')!, 'Save'); save.focus(); save.click();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    finishRead({ ok: true, json: async () => ({ value: { ...book, rules: [] } }) });
    await vi.waitFor(() => { flushSync(); expect(m.target.querySelector('dialog')).toBeNull(); expect(document.activeElement).toBe(m.target.querySelector('h1')); });
  });

  it('uses the heading when the editor mounted with BODY as its invoker', async () => {
    const m = mount(book); document.body.tabIndex = -1; document.body.focus();
    try {
      button(m.target, 'Edit').click(); flushSync(); const cancel = button(m.target.querySelector('dialog')!, 'Cancel'); cancel.focus(); cancel.click(); flushSync(); await tick();
      expect(document.activeElement).toBe(m.target.querySelector('h1'));
    } finally { document.body.removeAttribute('tabindex'); }
  });

});

describe('#1764 less-visible task warning on rule save', () => {
  const urn = 'hrn:node:acme.com:tasks:review-author';
  const warn = { code: 'TASK_LESS_VISIBLE', role: 'review', field: 'authorTask', taskUrn: urn, taskState: 'OK' };
  const saved = (warnings: unknown[]) => ({ ok: true, json: async () => ({ saved: true, warnings }) });
  const reloaded = { ok: true, json: async () => ({ value: { ...book, rules: [{ ...rule, revision: 8 }] } }) };
  async function save(m: ReturnType<typeof mount>, answer: unknown) {
    fetcher.mockResolvedValueOnce(answer).mockResolvedValueOnce(reloaded);
    const calls = fetcher.mock.calls.length;
    button(m.target, 'Edit').click(); flushSync();
    button(m.target.querySelector('dialog')!, 'Save').click();
    await vi.waitFor(() => { flushSync(); expect(fetcher.mock.calls.length).toBe(calls + 2); expect(m.target.querySelector('dialog')).toBeNull(); });
  }
  function startDeleteCreateRace() {
    let finishDelete!: (value: unknown) => void, resolveRead!: (value: unknown) => void, rejectRead!: (reason: Error) => void;
    let reads = 0;
    fetcher.mockImplementation((_url: string, options: { body: string }) => {
      const op = JSON.parse(options.body).op;
      if (op === 'delete') return new Promise(resolve => { finishDelete = resolve; });
      if (op === 'create') return Promise.resolve(saved([]));
      if (op === 'read') {
        if (++reads > 1) return Promise.resolve(reloaded);
        return new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; });
      }
      throw new Error(`Unexpected op ${op}`);
    });
    const m = mount(book);
    button(m.target, 'Delete').click();
    button(m.target, 'Create rule').click(); flushSync();
    const dialog = m.target.querySelector('dialog')!;
    const role = dialog.querySelector<HTMLInputElement>('input:not([type])')!;
    role.value = 'new-rule'; role.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    button(dialog, 'Save').click();
    return { m, dialog, finishDelete: (value: unknown) => finishDelete(value), resolveRead: (value: unknown) => resolveRead(value), rejectRead: (reason: Error) => rejectRead(reason),
      alert: m.target.querySelector('[data-rule-failure]'), feedback: m.target.querySelector('[data-rule-feedback]') };
  }
  it('defers an external row-failure announcement until the modal closes', async () => {
    let finishDelete!: (value: unknown) => void;
    fetcher.mockImplementation(() => new Promise(resolve => { finishDelete = resolve; }));
    const m = mount(book); const alert = m.target.querySelector('[data-rule-failure]');
    button(m.target, 'Delete').click(); button(m.target, 'Create rule').click(); flushSync();
    finishDelete({ ok: false, json: async () => ({ error: 'Delete refused' }) });
    await vi.waitFor(() => { flushSync(); expect(m.target.querySelector('[data-rule-feedback-visual]')?.textContent).toContain('Delete refused'); });
    expect(alert?.textContent?.trim()).toBe('');
    button(m.target.querySelector('dialog')!, 'Cancel').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.querySelector('dialog')).toBeNull(); expect(alert?.textContent).toContain('Delete refused'); });
  });
  it('shows the warning beside the saved notice, with the URN exactly as returned, and no raw code', async () => {
    const m = mount(book);
    const feedback = m.target.querySelector('[data-rule-feedback]');
    expect(feedback).not.toBeNull(); expect(feedback?.textContent).not.toContain('author task');
    expect(feedback?.classList).toContain('sr-only');
    expect(m.target.querySelector('[data-rule-failure]')?.classList).toContain('sr-only');
    await save(m, saved([warn]));
    expect(feedback?.textContent).toContain('author task');
    const text = m.target.textContent!;
    expect(text).toContain('Saved.'); expect(text).toContain('author task'); expect(text.replace(/\s/g, '')).toContain(urn);
    expect(text).not.toContain('TASK_LESS_VISIBLE');
    expect(m.target.querySelector('[data-rule-failure]')?.textContent ?? '').not.toContain('author task');
    expect(m.target.querySelector(`a[href*="${urn}"]`)).toBeNull();
  });
  it('repeats a value that is not a URN as the server sent it, without inventing a type prefix', async () => {
    const m = mount(book); await save(m, saved([{ ...warn, taskUrn: 'not a urn' }]));
    expect(m.target.querySelector('[data-task-warning] code')?.textContent).toBe('not a urn');
    expect(m.target.textContent).not.toContain('unknown');
  });
  it('repeats a legacy urn: alias verbatim instead of rewriting it through the chip', async () => {
    const alias = 'urn:node:acme.com:tasks:review-author';
    const m = mount(book); await save(m, saved([{ ...warn, taskUrn: alias }]));
    expect(m.target.querySelector('[data-task-warning] code')?.textContent).toBe(alias);
    expect(m.target.querySelector(`[data-task-warning] [title="${urn}"]`)).toBeNull();
  });
  it('updates the external live region only after the modal editor has closed', async () => {
    let finishRead!: (value: unknown) => void;
    fetcher.mockResolvedValueOnce(saved([warn])).mockReturnValueOnce(new Promise(resolve => { finishRead = resolve; }));
    const m = mount(book); const feedback = m.target.querySelector('[data-rule-feedback]');
    button(m.target, 'Edit').click(); flushSync();
    button(m.target.querySelector('dialog')!, 'Save').click();
    await vi.waitFor(() => { flushSync(); expect(fetcher).toHaveBeenCalledTimes(2); });
    expect(m.target.querySelector('dialog')).not.toBeNull();
    expect(feedback?.textContent).not.toContain('author task');
    finishRead(reloaded);
    await vi.waitFor(() => { flushSync(); expect(m.target.querySelector('dialog')).toBeNull(); expect(feedback?.textContent).toContain('author task'); });
  });
  it('updates a persistent assertive region with reload failure only after the modal closes', async () => {
    let failRead!: (reason: Error) => void;
    fetcher.mockResolvedValueOnce(saved([warn])).mockReturnValueOnce(new Promise((_, reject) => { failRead = reject; }));
    const m = mount(book); const alert = m.target.querySelector('[data-rule-failure]');
    expect(alert).not.toBeNull(); expect(alert?.getAttribute('aria-live')).toBe('assertive');
    expect(alert?.textContent).not.toContain('could not be reloaded');
    button(m.target, 'Edit').click(); flushSync();
    button(m.target.querySelector('dialog')!, 'Save').click();
    await vi.waitFor(() => { flushSync(); expect(fetcher).toHaveBeenCalledTimes(2); });
    expect(m.target.querySelector('dialog')).not.toBeNull();
    expect(alert?.textContent).not.toContain('could not be reloaded');
    failRead(new Error('offline'));
    await vi.waitFor(() => { flushSync(); expect(m.target.querySelector('dialog')).toBeNull(); expect(alert?.textContent).toContain('Saved, but the rules could not be reloaded.'); });
    expect(alert?.textContent).toContain('author task');
    expect(m.target.querySelector('[data-rule-feedback]')?.textContent?.trim()).toBe('');
  });
  it('keeps an earlier row-action failure beside this save feedback', async () => {
    const r = startDeleteCreateRace();
    await vi.waitFor(() => { flushSync(); expect(fetcher).toHaveBeenCalledTimes(3); });
    r.finishDelete({ ok: false, json: async () => ({ error: 'Delete refused' }) });
    await vi.waitFor(() => { flushSync(); expect(r.m.target.querySelector('[data-rule-feedback-visual]')?.textContent).toContain('Delete refused'); });
    expect(r.alert?.textContent?.trim()).toBe('');
    r.resolveRead(reloaded);
    await vi.waitFor(() => { flushSync(); expect(r.dialog.isConnected).toBe(false); });
    expect(r.alert?.textContent).toContain('Delete refused');
    expect(r.alert?.textContent).toContain('Saved.');
    expect(r.feedback?.textContent?.trim()).toBe('');
  });
  it('does not replace a newer row failure with an older save reload failure', async () => {
    const r = startDeleteCreateRace();
    await vi.waitFor(() => { flushSync(); expect(fetcher).toHaveBeenCalledTimes(3); });
    r.rejectRead(new Error('offline'));
    r.finishDelete({ ok: false, json: async () => ({ error: 'Delete refused' }) });
    await vi.waitFor(() => { flushSync(); expect(r.dialog.isConnected).toBe(false); expect(r.alert?.textContent).toContain('Delete refused'); });
    expect(r.alert?.textContent).toContain('could not be reloaded');
  });
  it('does not replace newer row success feedback with the older save notice', async () => {
    const r = startDeleteCreateRace();
    await vi.waitFor(() => { flushSync(); expect(fetcher).toHaveBeenCalledTimes(3); });
    r.resolveRead(reloaded);
    await Promise.resolve(); await Promise.resolve();
    r.finishDelete({ ok: true, json: async () => ({}) });
    await vi.waitFor(() => { flushSync(); expect(r.dialog.isConnected).toBe(false); expect(r.feedback?.textContent).toContain('Deleted.'); });
    expect(r.feedback?.textContent).not.toContain('Saved.');
  });
  it('keeps save feedback mounted when the follow-up read conceals the rulebook', async () => {
    fetcher.mockResolvedValueOnce(saved([warn])).mockResolvedValueOnce({ ok: true, json: async () => ({ value: null }) });
    const m = mount(book); const feedback = m.target.querySelector('[data-rule-feedback]');
    const visual = m.target.querySelector('[data-rule-feedback-visual]');
    button(m.target, 'Edit').click(); flushSync();
    button(m.target.querySelector('dialog')!, 'Save').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.querySelector('dialog')).toBeNull(); });
    expect(m.target.querySelector('table')).toBeNull();
    expect(m.target.querySelector('[data-rule-feedback]')).toBe(feedback);
    expect(feedback?.textContent).toContain('Saved.'); expect(feedback?.textContent).toContain('author task');
    expect(document.activeElement).toBe(visual);
  });
  it('clears old feedback when the view is concealed or replaced', async () => {
    fetcher.mockResolvedValueOnce(saved([warn])).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'offline' }) });
    const m = mount(book); await save(m, saved([warn]));
    expect(m.target.querySelector('[data-rule-failure]')?.textContent).toContain('could not be reloaded');
    m.props.initial = null; flushSync();
    expect(m.target.querySelector('[data-rule-feedback]')?.textContent?.trim()).toBe('');
    expect(m.target.querySelector('[data-rule-failure]')?.textContent?.trim()).toBe('');
    expect(button(m.target, 'Reload')).toBeUndefined();
  });
  it('is still readable after the rule list has refreshed', async () => {
    const m = mount(book); await save(m, saved([warn]));
    expect(m.target.textContent).toContain('author task');
    expect(m.target.textContent).toContain('Saved.');
  });
  it('a save answering no warnings shows nothing, and clears an earlier warning', async () => {
    const m = mount(book); await save(m, saved([warn]));
    expect(m.target.textContent).toContain('author task');
    await save(m, saved([]));
    expect(m.target.textContent).toContain('Saved.');
    expect(m.target.textContent).not.toContain('author task'); expect(m.target.textContent).not.toContain('may not');
  });
  it('a warning does not turn the save into a failure', async () => {
    const m = mount(book); await save(m, saved([warn]));
    expect(m.target.querySelector('[data-rule-failure]')?.textContent?.trim()).toBe('');
  });
  it('an old-shaped answer without warnings, a null field and an unknown code never throw', async () => {
    const m = mount(book); await save(m, { ok: true, json: async () => ({ saved: true }) });
    expect(m.target.textContent).toContain('Saved.');
    await save(m, saved([{ ...warn, field: null }, { ...warn, code: 'NEW_CODE' }]));
    expect(m.target.textContent).not.toContain('NEW_CODE'); expect(m.target.textContent).not.toContain('TASK_LESS_VISIBLE');
  });
  it('labels every task copy control with its field and role', async () => {
    const m = mount(book); await save(m, saved([warn, { ...warn, field: 'validationTask' }]));
    const labels = [...m.target.querySelectorAll('[data-task-warning] button[aria-label]')].map(b => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Copy author task for “review” URN', 'Copy validation task for “review” URN']);
    for (const control of m.target.querySelectorAll('[data-task-warning] button')) expect(control.closest('[data-rule-feedback], [data-rule-failure]')).toBeNull();
  });
  it('a later save that is refused does not keep the earlier save’s warning beside the failure', async () => {
    const m = mount(book); await save(m, saved([warn]));
    expect(m.target.textContent).toContain('author task');
    fetcher.mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'CONFLICT', error: 'The rule changed.' }) });
    button(m.target, 'Edit').click(); flushSync();
    button(m.target.querySelector('dialog')!, 'Save').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('The rule changed.'); });
    expect(m.target.textContent).not.toContain('author task');
  });
  it('a later delete clears the warning from the earlier save', async () => {
    const m = mount(book); await save(m, saved([warn]));
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({}) }).mockResolvedValueOnce(reloaded);
    button(m.target, 'Delete').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('Deleted.'); });
    expect(m.target.textContent).not.toContain('author task');
  });

});

describe('portal#1761 grid search', () => {
  it('filters rulebook rows and restores them when cleared', () => {
    const m = mount({ rules: [{ ...rule, authorTask: 'hrn:node:acme.com:private:secret-reference' }, { ...rule, id: 'r2', role: 'publish', enabled: false, writers: 'ADMIN', authorTask: null, authorTaskState: 'NONE' }] });
    expect(m.target.querySelectorAll('tbody tr')).toHaveLength(2);
    search(m.target, 'review');
    expect(m.target.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(m.target.querySelector('tbody')?.textContent).toContain('review');
    expect(m.target.querySelector('tbody')?.textContent).not.toContain('publish');
    search(m.target, '');
    expect(m.target.querySelectorAll('tbody tr')).toHaveLength(2);
    search(m.target, 'ADMIN');
    expect(m.target.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(m.target.querySelector('tbody')?.textContent).toContain('publish');
    expect(m.target.querySelector('tbody')?.textContent).not.toContain('review');
    search(m.target, 'UNREADABLE');
    expect(m.target.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(m.target.querySelector('tbody')?.textContent).toContain('review');
    expect(m.target.querySelector('tbody')?.textContent).not.toContain('publish');
    search(m.target, 'secret-reference');
    expect(m.target.querySelectorAll('tbody tr')).toHaveLength(0);
  });
});
