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
    const m = mount({ rules: [{ ...rule, locked: true, sourceTemplate: { id: 't', name: 'baseline', deleted: false } }] }, true);
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

});
