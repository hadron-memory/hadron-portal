/**
 * portal#1809 item 4: the editor's own tests mount RuleEditor directly, so they
 * prove its state is per-instance, not that the two managers actually give it a
 * fresh instance. These pins drive it through RulebookManager and
 * TemplatesManager: pick a reference, close the editor, open it again, and the
 * earlier override must be gone. They fail if a manager keeps the editor mounted.
 * Mount-scoped seeding is unchanged and no live-prop-swap contract is implied.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { PICK_FIRST } from '$lib/test/fixtures/ruleEditorPicker';
import type { Rule, Rulebook, Template } from '$lib/memory-config/types';
vi.mock('$lib/components/SelectNode.svelte', async () => ({ default: (await import('$lib/test/fixtures/RuleEditorPickerStub.svelte')).default }));
import RulebookManager from './RulebookManager.svelte';
import TemplatesManager from './TemplatesManager.svelte';

const rule: Rule = { id: 'r1', role: 'review', revision: 7, enabled: true, strictSubRoles: false, writers: 'ALL', validateBy: null, locked: false,
  authorTask: null, authorTaskId: null, authorTaskState: 'NONE', validationTask: null, validationTaskId: null, validationTaskState: 'NONE', descriptionNode: null, descriptionNodeId: null, descriptionNodeState: 'NONE' };
const book: Rulebook = { id: 'config', rules: [rule] };
const template: Template = { id: 't1', name: 'baseline', description: 'd', required: false, revision: 1, rules: [rule] };
const dialogKeys = ['showModal', 'close'] as const;
const savedDialog = new Map<string, PropertyDescriptor | undefined>();
let cleanup: (() => void)[] = [];
beforeEach(() => {
  for (const key of dialogKeys) savedDialog.set(key, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, key));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, writable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, writable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  cleanup.splice(0).forEach(f => f()); vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const key of dialogKeys) {
    const prior = savedDialog.get(key);
    if (prior) Object.defineProperty(HTMLDialogElement.prototype, key, prior);
    else delete (HTMLDialogElement.prototype as unknown as Record<string, unknown>)[key];
  }
});
function btn(root: ParentNode, name: string) {
  const found = [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === name);
  expect(found, `no "${name}" button; buttons present: ${[...root.querySelectorAll('button')].map(b => JSON.stringify(b.textContent?.trim())).join(', ')}`).toBeDefined();
  return found!;
}
function click(root: ParentNode, name: string) { btn(root, name).click(); flushSync(); }
function authorRow(dialog: HTMLElement) {
  const label = [...dialog.querySelectorAll('p')].find(p => p.textContent === 'Author task');
  expect(label, 'no Author task row in the open editor').toBeDefined();
  return label!.parentElement!;
}
const compact = (el: Element) => el.textContent?.replace(/\s/g, '') ?? '';

describe('portal#1809 RuleEditor reopen through its consumers', () => {
  it('RulebookManager: a prior override is discarded when the editor is closed and opened again', async () => {
    const m = mountComponent(RulebookManager, { initial: book, readOnly: false, memoryRef: 'memory', memories: [], memoriesFailed: false }); cleanup.push(m.unmount);
    click(m.target, 'Create rule');
    let dialog = m.target.querySelector('dialog')!;
    click(authorRow(dialog), 'Change…'); click(dialog, 'Pick first'); await tick();
    expect(compact(authorRow(dialog))).toContain(PICK_FIRST);
    click(dialog, 'Cancel'); await tick();
    expect(m.target.querySelector('dialog')).toBeNull();
    click(m.target, 'Create rule');
    dialog = m.target.querySelector('dialog')!;
    expect(authorRow(dialog).textContent).toContain('None');
    expect(compact(authorRow(dialog))).not.toContain(PICK_FIRST);
  });
  it('RulebookManager: switching the open editor to another rule instance (reload) discards the override', async () => {
    const m = mountComponent(RulebookManager, { initial: book, readOnly: false, memoryRef: 'memory', memories: [], memoriesFailed: false }); cleanup.push(m.unmount);
    const fetcher = vi.mocked(globalThis.fetch);
    // The save is refused with CONFLICT; every later call is the reload read.
    fetcher.mockImplementation(async (_url, init) => JSON.parse(String((init as RequestInit).body)).op === 'read'
      ? new Response(JSON.stringify({ value: book }), { status: 200 })
      : new Response(JSON.stringify({ code: 'CONFLICT', error: 'The rule changed.' }), { status: 409 }));
    click(m.target, 'Edit');
    let dialog = m.target.querySelector('dialog')!;
    click(authorRow(dialog), 'Change…'); click(dialog, 'Pick first'); await tick();
    expect(compact(authorRow(dialog))).toContain(PICK_FIRST);
    click(dialog, 'Save');
    await vi.waitFor(() => { flushSync(); expect(dialog.textContent).toContain('The rule changed.'); });
    click(dialog, 'Reload the rule (discards your changes)');
    await vi.waitFor(() => { flushSync(); expect(m.target.querySelector('dialog')).not.toBe(dialog); });
    dialog = m.target.querySelector('dialog')!;
    expect(authorRow(dialog).textContent).toContain('None');
    expect(compact(authorRow(dialog))).not.toContain(PICK_FIRST);
  });
  it('TemplatesManager: a prior override is discarded when the rule editor is closed and opened again', async () => {
    const m = mountComponent(TemplatesManager, { initial: [template], ownerType: 'USER' as const, ownerRef: 'u1', readOnly: false, canManage: true, memories: [], memoriesFailed: false }); cleanup.push(m.unmount);
    click(m.target, 'Edit');
    click(m.target, 'Add rule');
    let dialog = m.target.querySelector('dialog')!;
    click(authorRow(dialog), 'Change…'); click(dialog, 'Pick first'); await tick();
    expect(compact(authorRow(dialog))).toContain(PICK_FIRST);
    click(dialog, 'Cancel'); await tick();
    expect(m.target.querySelector('dialog')).toBeNull();
    click(m.target, 'Add rule');
    dialog = m.target.querySelector('dialog')!;
    expect(authorRow(dialog).textContent).toContain('None');
    expect(compact(authorRow(dialog))).not.toContain(PICK_FIRST);
  });
});
