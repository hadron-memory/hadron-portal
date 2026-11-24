/**
 * portal#1749 B2: causal pins for the template editor's draft and save behaviour, driven through the real
 * TemplatesManager and RuleEditor: a held double submit is one request, Clear sends an explicit null while an
 * untouched field is left out, a one-rule edit re-sends every untouched rule with its reference state, and an
 * unreadable or broken reference refuses before any request. Each pin has a healthy control in the same file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import TemplatesManager from './TemplatesManager.svelte';
import type { Rule, Template, RefState } from '$lib/memory-config/types';

const base: Rule = { role: 'review', enabled: true, strictSubRoles: false, writers: 'ALL', validateBy: null,
  authorTask: null, authorTaskId: null, authorTaskState: 'NONE', validationTask: null, validationTaskId: null, validationTaskState: 'NONE', descriptionNode: null, descriptionNodeId: null, descriptionNodeState: 'NONE' };
const withAuthor = (role: string, state: RefState = 'OK'): Rule => ({ ...base, role, authorTask: `hrn:node:acme.com:m:tasks:${role}`, authorTaskId: `id-${role}`, authorTaskState: state });
const template = (rules: Rule[], over: Partial<Template> = {}): Template => ({ id: 't1', name: 'baseline', description: 'Test rulebook', required: false, revision: 4, rules, ...over });

const dialogKeys = ['showModal', 'close'] as const;
const savedDialog = new Map<string, PropertyDescriptor | undefined>();
const fetcher = vi.fn();
let cleanup: (() => void)[] = [];
const ok = (body: unknown = {}) => ({ ok: true, json: async () => body });
const bodies = () => fetcher.mock.calls.map(c => JSON.parse(c[1].body));
const writes = () => bodies().filter(b => b.op === 'update' || b.op === 'create');
beforeEach(() => {
  localStorage.clear();
  for (const key of dialogKeys) savedDialog.set(key, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, key));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, writable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, writable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
  fetcher.mockReset(); vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  cleanup.splice(0).forEach(f => f()); vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const key of dialogKeys) {
    const prior = savedDialog.get(key);
    if (prior) Object.defineProperty(HTMLDialogElement.prototype, key, prior);
    else delete (HTMLDialogElement.prototype as unknown as Record<string, unknown>)[key];
  }
});
function mount(initial: Template[]) {
  const m = mountComponent(TemplatesManager, { initial, ownerType: 'ORGANIZATION' as const, ownerRef: 'o1', readOnly: false, canManage: true, memories: [], memoriesFailed: false });
  cleanup.push(m.unmount); return m;
}
const btn = (root: ParentNode, name: string) => [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === name) as HTMLButtonElement;
const editor = (m: { target: HTMLElement }) => m.target.querySelector('[aria-label="Template editor"]') as HTMLElement;
const dialog = (m: { target: HTMLElement }) => m.target.querySelector('dialog') as HTMLDialogElement;
function openTemplate(m: { target: HTMLElement }) { btn(m.target, 'Edit').click(); flushSync(); }
/** Open the draft row for `role`, run `change` in the rule dialog, and press the dialog's own Save. */
function editRule(m: { target: HTMLElement }, role: string, change: (d: HTMLDialogElement) => void) {
  const row = [...editor(m).querySelectorAll('tbody tr')].find(r => r.textContent?.includes(role))!;
  btn(row, 'Edit').click(); flushSync();
  change(dialog(m)); flushSync();
  btn(dialog(m), 'Save').click(); flushSync();
}
const toggleEnabled = (d: HTMLDialogElement) => (([...d.querySelectorAll('label')].find(l => l.textContent?.trim() === 'Enabled')!.querySelector('input')) as HTMLInputElement).click();
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }

describe('portal#1749 B2: a double submit while a save is in flight sends one request', () => {
  it('ignores a second submit of the form while the first is held', async () => {
    let release!: (v: unknown) => void;
    fetcher.mockImplementation(async (_u, init) => JSON.parse(init.body).op === 'update' ? new Promise(r => { release = r; }) : ok({ value: [template([])] }));
    const m = mount([template([])]); openTemplate(m);
    const form = editor(m).querySelector('form')!;
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })); flushSync();
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })); flushSync();
    expect(writes()).toHaveLength(1);
    release(ok()); await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('Saved.'); });
    expect(writes()).toHaveLength(1);
  });
  it('control: after the first save settles, a later save is sent', async () => {
    fetcher.mockImplementation(async (_u, init) => JSON.parse(init.body).op === 'update' ? ok() : ok({ value: [template([])] }));
    const m = mount([template([])]); openTemplate(m);
    btn(m.target, 'Save').click(); await vi.waitFor(() => { flushSync(); expect(m.target.textContent).toContain('Saved.'); });
    await vi.waitFor(() => { flushSync(); expect(btn(m.target, 'Edit')).toBeDefined(); });
    openTemplate(m); btn(m.target, 'Save').click();
    await vi.waitFor(() => expect(writes()).toHaveLength(2));
  });
});

describe('portal#1749 B2: Clear sends an explicit null, an untouched field is left out', () => {
  it('an emptied description is sent as null, not an empty string', async () => {
    fetcher.mockImplementation(async (_u, init) => JSON.parse(init.body).op === 'update' ? ok() : ok({ value: [] }));
    const m = mount([template([])]); openTemplate(m);
    type(editor(m).querySelector('textarea')!, ''); btn(m.target, 'Save').click();
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].input).toHaveProperty('description', null);
  });
  it('control: an untouched description is sent as stored text, and an untouched rule set sends no rules key', async () => {
    fetcher.mockImplementation(async (_u, init) => JSON.parse(init.body).op === 'update' ? ok() : ok({ value: [] }));
    const m = mount([template([withAuthor('review')])]); openTemplate(m);
    btn(m.target, 'Save').click();
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].input.description).toBe('Test rulebook');
    expect(writes()[0].input).not.toHaveProperty('rules');
  });
  it('create always sends the rule list, even an empty one', async () => {
    fetcher.mockImplementation(async (_u, init) => JSON.parse(init.body).op === 'create' ? ok() : ok({ value: [] }));
    const m = mount([]); btn(m.target, 'Create template').click(); flushSync();
    type(editor(m).querySelector('input[maxlength="64"]')!, 'fresh'); btn(m.target, 'Save').click();
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ op: 'create', input: { name: 'fresh', rules: [] } });
  });
  it('clearing a rule reference in the editor sends that reference as null', async () => {
    fetcher.mockImplementation(async (_u, init) => JSON.parse(init.body).op === 'update' ? ok() : ok({ value: [] }));
    const m = mount([template([withAuthor('review')])]); openTemplate(m);
    editRule(m, 'review', d => btn(d, 'Clear').click());
    btn(m.target, 'Save').click();
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].input.rules).toEqual([expect.objectContaining({ role: 'review', authorTaskRef: null, validationTaskRef: null, descriptionNodeRef: null })]);
  });
});

describe('portal#1749 B2: a one-rule edit re-sends every untouched rule with its reference state', () => {
  it('sends OK references as their ids and NONE as null for rules that were not edited', async () => {
    fetcher.mockImplementation(async (_u, init) => JSON.parse(init.body).op === 'update' ? ok() : ok({ value: [] }));
    const untouched = { ...withAuthor('audit'), validationTask: 'hrn:node:acme.com:m:tasks:val', validationTaskId: 'id-val', validationTaskState: 'OK' as RefState };
    const m = mount([template([withAuthor('review'), untouched])]); openTemplate(m);
    editRule(m, 'review', toggleEnabled);
    btn(m.target, 'Save').click();
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
    const rules = writes()[0].input.rules as Record<string, unknown>[];
    expect(rules).toHaveLength(2);
    const edited = rules.find(r => r.role === 'review')!, other = rules.find(r => r.role === 'audit')!;
    expect(edited).toMatchObject({ enabled: false, authorTaskRef: 'id-review', validationTaskRef: null, descriptionNodeRef: null });
    expect(other).toMatchObject({ enabled: true, authorTaskRef: 'id-audit', validationTaskRef: 'id-val', descriptionNodeRef: null });
  });
});

describe('portal#1749 B2: an unavailable reference refuses before any request', () => {
  it.each(['UNREADABLE', 'BROKEN'] as const)('%s on an untouched rule blocks the save and sends nothing', async state => {
    fetcher.mockResolvedValue(ok({ value: [] }));
    const m = mount([template([withAuthor('review'), withAuthor('audit', state)])]); openTemplate(m);
    editRule(m, 'review', toggleEnabled);
    btn(m.target, 'Save').click();
    await vi.waitFor(() => { flushSync(); expect(editor(m).textContent).toContain('Choose or clear the unavailable references for rule “audit”'); });
    expect(fetcher).not.toHaveBeenCalled();
    expect(btn(m.target, 'Save')).toBeDefined();
  });
  it('control: once the unavailable reference is cleared in the editor, the save goes out with null for it', async () => {
    fetcher.mockImplementation(async (_u, init) => JSON.parse(init.body).op === 'update' ? ok() : ok({ value: [] }));
    const m = mount([template([withAuthor('audit', 'UNREADABLE')])]); openTemplate(m);
    editRule(m, 'audit', d => btn(d, 'Clear').click());
    btn(m.target, 'Save').click();
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].input.rules).toEqual([expect.objectContaining({ role: 'audit', authorTaskRef: null })]);
  });
});
