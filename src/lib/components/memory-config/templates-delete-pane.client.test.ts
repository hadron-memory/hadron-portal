import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import { resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import TemplatesManager from './TemplatesManager.svelte';
import type { Template } from '$lib/memory-config/types';

// portal#1749 (C3 + D): deleting the template the Apply pane points at must retire
// the pane; deleting any other template, or failing to delete, must not touch it.
const first: Template = { id: 't1', name: 'baseline', description: 'First', required: true, revision: 9, rules: [] };
const second: Template = { id: 't2', name: 'extras', description: 'Second', required: false, revision: 3, rules: [] };
const preview = { memoryId: 'm1', templateRevision: 9, required: true, dryRun: true, entries: [{ role: 'review', outcome: 'APPLIED' }], warnings: [] };
const fetcher = vi.fn();
let cleanup: (() => void)[] = [];

function mount() {
  const m = mountComponent(TemplatesManager, { initial: [first, second], ownerType: 'USER' as const, ownerRef: 'u1', readOnly: false, canManage: true, memories: [{ id: 'm1', name: 'My memory', urn: 'hrn:mem:acme.com:memory' }], memoriesFailed: false });
  cleanup.push(m.unmount); return m;
}
const buttons = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].filter(b => b.textContent?.trim() === text);
const button = (root: HTMLElement, text: string) => buttons(root, text)[0];
const applyHeading = (root: HTMLElement, name: string) => root.textContent?.includes(`Apply “${name}”`) ?? false;

/** Open the Apply pane on the FIRST row (baseline) and, when asked, run a preview in it. */
async function openPane(m: ReturnType<typeof mount>, withPreview: boolean) {
  buttons(m.target, 'Apply to a memory…')[0].click(); flushSync();
  expect(applyHeading(m.target, 'baseline')).toBe(true);
  if (!withPreview) return;
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ value: preview }) });
  button(m.target, 'Choose memory…').click(); flushSync();
  m.target.querySelector<HTMLButtonElement>('button[aria-label="Select My memory"]')!.click(); flushSync();
  button(m.target, 'Preview').click();
  await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('Preview: nothing has been changed'); });
  expect(button(m.target, 'Apply and lock rules')).toBeDefined();
}
const deleteRow = (m: ReturnType<typeof mount>, index: number) => buttons(m.target, 'Delete')[index].click();

beforeEach(() => { localStorage.clear(); resetNavigationGuards(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher); vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup.splice(0).forEach(f => f()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('portal#1749 C3: deleting the chosen template retires the Apply pane', () => {
  it('a successful delete of the chosen template removes the pane, its preview and the apply step', async () => {
    const m = mount(); await openPane(m, true);
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({}) }).mockResolvedValueOnce({ ok: true, json: async () => ({ value: [second] }) });
    deleteRow(m, 0);
    await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('Deleted.'); });
    expect(applyHeading(m.target, 'baseline')).toBe(false);
    expect(m.target.textContent).not.toContain('Preview: nothing has been changed');
    expect(button(m.target, 'Apply and lock rules')).toBeUndefined();
    expect(button(m.target, 'Choose memory…')).toBeUndefined();
    // No apply is offered or sent: only the preview, the delete and the reload went out.
    expect(fetcher.mock.calls.map(c => JSON.parse(c[1].body).op)).toEqual(['preview', 'delete', 'read']);
  });

  it('a pane that has no preview yet is retired too, and the chosen memory does not leak into the next pane', async () => {
    const m = mount(); await openPane(m, false);
    button(m.target, 'Choose memory…').click(); flushSync();
    m.target.querySelector<HTMLButtonElement>('button[aria-label="Select My memory"]')!.click(); flushSync();
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({}) }).mockResolvedValueOnce({ ok: true, json: async () => ({ value: [second] }) });
    deleteRow(m, 0);
    await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('Deleted.'); });
    expect(applyHeading(m.target, 'baseline')).toBe(false);
    buttons(m.target, 'Apply to a memory…')[0].click(); flushSync();
    expect(applyHeading(m.target, 'extras')).toBe(true);
    expect(button(m.target, 'Preview').disabled).toBe(true); // the old memory choice did not survive
  });

  it('deleting a different template leaves the pane and its preview alone', async () => {
    const m = mount(); await openPane(m, true);
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({}) }).mockResolvedValueOnce({ ok: true, json: async () => ({ value: [first] }) });
    deleteRow(m, 1);
    await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('Deleted.'); });
    expect(applyHeading(m.target, 'baseline')).toBe(true);
    expect(m.target.textContent).toContain('Preview: nothing has been changed');
    expect(button(m.target, 'Apply and lock rules')).toBeDefined();
  });

  it('a failed delete of the chosen template leaves the pane and its preview alone', async () => {
    const m = mount(); await openPane(m, true);
    fetcher.mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'CONFLICT', error: 'The template changed.' }) });
    deleteRow(m, 0);
    await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('The template changed.'); });
    expect(applyHeading(m.target, 'baseline')).toBe(true);
    expect(m.target.textContent).toContain('Preview: nothing has been changed');
    expect(button(m.target, 'Apply and lock rules')).toBeDefined();
  });
});

describe('portal#1749 D: the template editor is a named group', () => {
  it('the editor wrapper has a role, so its label is announced', () => {
    const m = mount(); button(m.target, 'Edit').click(); flushSync();
    const editor = m.target.querySelector('[aria-label="Template editor"]')!;
    expect(editor).not.toBeNull();
    expect(editor.getAttribute('role')).toBe('group');
  });
});
