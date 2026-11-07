import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import type { Rule } from '$lib/memory-config/types';
import type { ConfigFailure } from '$lib/memory-config/client';
vi.mock('$lib/components/SelectNode.svelte', async () => ({ default: (await import('$lib/test/fixtures/RuleEditorPickerStub.svelte')).default }));
import RuleEditor from './RuleEditor.svelte';

const fields = ['authorTask', 'validationTask', 'descriptionNode'] as const;
const labels = ['Author task', 'Validation task', 'Description node'];
const first = 'hrn:node:example.com:tasks:first';
const second = 'hrn:node:example.com:tasks:second';
const seed: Rule = { id: 'r', role: 'review', revision: 1, enabled: false, strictSubRoles: false, writers: 'ALL', validateBy: null, locked: false,
  authorTask: first, authorTaskId: 'a', authorTaskState: 'OK', validationTask: null, validationTaskId: null, validationTaskState: 'UNREADABLE', descriptionNode: null, descriptionNodeId: null, descriptionNodeState: 'BROKEN' };
let cleanup: (() => void)[] = [];
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup.splice(0).forEach(f => f()); vi.restoreAllMocks(); });
function mount(rule: Rule | null = null) {
  const onsave = vi.fn(async (_input: Record<string, unknown>): Promise<ConfigFailure | null> => null);
  const onreload = vi.fn(async () => undefined);
  const props = reactiveProps({ rule, memories: [], memoriesFailed: false, oncancel: vi.fn(), onsave, onreload });
  const m = mountComponent(RuleEditor, props); cleanup.push(m.unmount);
  return { ...m, props, onsave, onreload };
}
function click(root: HTMLElement, name: string) {
  const b = [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === name);
  expect(b, name).toBeDefined(); b!.click(); flushSync();
}
function row(root: HTMLElement, index: number) {
  return [...root.querySelectorAll('p')].find(p => p.textContent === labels[index])!.parentElement!;
}
function pick(root: HTMLElement, index: number, which = 'first') {
  click(row(root, index), 'Change…'); click(root, `Pick ${which}`);
}
function submit(root: HTMLElement) {
  root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); flushSync();
}
describe('portal#1804 RuleEditor reference overrides (callback stub)', () => {
  it.each(fields)('%s displays the selection before Save, whose payload already has it', async field => {
    const i = fields.indexOf(field); const m = mount(); pick(m.target, i); await tick();
    // Capture the original mismatch too: save is correct even when the display is stale.
    const visible = row(m.target, i).textContent?.replace(/\s/g, '');
    submit(m.target); expect(m.onsave).toHaveBeenCalledWith(expect.objectContaining({ [`${field}Ref`]: first }));
    expect(visible).toContain(first);
    for (const other of fields.filter(f => f !== field)) expect(m.onsave.mock.calls[0][0]).not.toHaveProperty(`${other}Ref`);
  });
  it.each(fields)('%s keeps the latest pick through rerender and picker cancel, then Clear sends only null', async field => {
    const i = fields.indexOf(field); const m = mount(seed);
    pick(m.target, i); pick(m.target, i, 'second');
    m.props.memoriesFailed = true; flushSync();
    click(row(m.target, i), 'Change…'); click(m.target, 'Cancel picker'); await tick();
    expect(row(m.target, i).textContent?.replace(/\s/g, '')).toContain(second);
    click(row(m.target, i), 'Clear'); await tick();
    expect(row(m.target, i).textContent).toContain('None'); expect(row(m.target, i).textContent).not.toContain(second);
    submit(m.target); expect(m.onsave).toHaveBeenCalledWith(expect.objectContaining({ [`${field}Ref`]: null }));
    for (const other of fields.filter(f => f !== field)) expect(m.onsave.mock.calls[0][0]).not.toHaveProperty(`${other}Ref`);
  });
  it.each(fields.flatMap(field => [false, true].map(edit => ({ field, edit }))))('$field select twice sends the latest value (edit=$edit)', async ({ field, edit }) => {
    const i = fields.indexOf(field); const m = mount(edit ? seed : null);
    pick(m.target, i); pick(m.target, i, 'second');
    m.props.memoriesFailed = true; flushSync();
    click(row(m.target, i), 'Change…'); click(m.target, 'Cancel picker'); await tick();
    expect(row(m.target, i).textContent?.replace(/\s/g, '')).toContain(second);
    submit(m.target);
    expect(m.onsave).toHaveBeenCalledWith(expect.objectContaining({ [`${field}Ref`]: second }));
    for (const other of fields.filter(f => f !== field)) expect(m.onsave.mock.calls[0][0]).not.toHaveProperty(`${other}Ref`);
  });
  it('preserves seeded states and omits all unchanged references', () => {
    const m = mount(seed); expect(row(m.target, 0).textContent?.replace(/\s/g, '')).toContain(first);
    expect(row(m.target, 1).textContent).toContain('UNREADABLE'); expect(row(m.target, 2).textContent).toContain('BROKEN');
    submit(m.target); for (const field of fields) expect(m.onsave.mock.calls[0][0]).not.toHaveProperty(`${field}Ref`);
  });
  it('keeps an unresolved conflict when its reload became stale', async () => {
    const m = mount(); m.onsave.mockResolvedValueOnce({ code: 'CONFLICT', error: 'Seed conflict' });
    submit(m.target);
    await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('Seed conflict'); });
    click(m.target, 'Reload the rule (discards your changes)');
    await vi.waitFor(() => { flushSync(); expect(m.onreload).toHaveBeenCalledOnce(); });
    await vi.waitFor(() => { flushSync(); expect([...m.target.querySelectorAll('button')].some(b => b.textContent?.trim() === 'Save')).toBe(true); });
    expect(m.target.textContent).toContain('Seed conflict');
    expect([...m.target.querySelectorAll('button')].some(b => b.textContent?.trim() === 'Reload the rule (discards your changes)')).toBe(true);
  });
  it('Clear replaces a seeded reference immediately and reopen has no prior override', async () => {
    const m = mount(seed); click(row(m.target, 0), 'Clear'); await tick();
    expect(row(m.target, 0).textContent).toContain('None'); expect(row(m.target, 0).textContent).not.toContain(first);
    click(m.target, 'Cancel'); expect(m.props.oncancel).toHaveBeenCalledOnce(); m.unmount();
    const reopened = mount(); for (let i = 0; i < 3; i++) expect(row(reopened.target, i).textContent).toContain('None');
    submit(reopened.target); for (const field of fields) expect(reopened.onsave.mock.calls[0][0]).not.toHaveProperty(`${field}Ref`);
  });
});
