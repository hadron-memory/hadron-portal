import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import RulebookManager from './RulebookManager.svelte';
import type { Rule, Rulebook } from '$lib/memory-config/types';

const rule: Rule = { id: 'r', role: 'old-role', revision: 1, enabled: true, strictSubRoles: false, writers: 'ALL', validateBy: null, locked: false, authorTask: null, authorTaskId: null, authorTaskState: 'NONE', validationTask: null, validationTaskId: null, validationTaskState: 'NONE', descriptionNode: null, descriptionNodeId: null, descriptionNodeState: 'NONE' };
const book = (role = 'old-role', revision = 1): Rulebook => ({ id: 'config', rules: [{ ...rule, role, revision }] });
const reply = (body: unknown, ok = true) => ({ ok, json: async () => body } as Response);
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
type Request = { op: string; input?: Record<string, unknown>; revision?: number };
let reads: ReturnType<typeof deferred<Response>>[], calls: Request[], cleanups: (() => void)[];
let mutate: (request: Request) => Promise<Response>;
const fetcher = vi.fn();
function mount(initial: Rulebook | null = book()) {
  const props = reactiveProps({ initial, readOnly: false, memoryRef: 'same-memory', memories: [], memoriesFailed: false });
  const m = mountComponent(RulebookManager, props); cleanups.push(m.unmount); return { ...m, props };
}
function button(root: HTMLElement, name: string) { return [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === name); }
function click(root: HTMLElement, name: string) { const b = button(root, name); expect(b, name).toBeDefined(); b!.click(); flushSync(); }
async function settle() { await tick(24); }
async function banner(m: ReturnType<typeof mount>) { click(m.target, 'Delete'); await settle(); expect(m.target.textContent).toContain('Seed refusal'); }
function release(at: number, value: Rulebook | null) { reads[at].resolve(reply({ value })); }
function concealed(m: ReturnType<typeof mount>) { expect(m.target.querySelector('table')).toBeNull(); expect(button(m.target, 'Create rule')).toBeUndefined(); expect(m.target.textContent).not.toContain('old-role'); }
beforeEach(() => {
  localStorage.clear(); reads = []; calls = []; cleanups = [];
  mutate = async () => reply({ error: 'Seed refusal', code: 'CONFLICT' }, false);
  fetcher.mockReset().mockImplementation((_url, init) => {
    const request = JSON.parse(init.body) as Request; calls.push(request);
    if (request.op === 'read') { const read = deferred<Response>(); reads.push(read); return read.promise; }
    return mutate(request);
  });
  vi.stubGlobal('fetch', fetcher); vi.spyOn(window, 'confirm').mockReturnValue(true);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanups.forEach(f => f()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('same-instance rulebook response ownership', () => {
  it('rejects old read after initial=null and still accepts a current read after a legitimate new generation', async () => {
    const m = mount(); await banner(m); click(m.target, 'Reload'); expect(reads).toHaveLength(1);
    m.props.initial = null; flushSync(); concealed(m);
    release(0, book()); await settle(); concealed(m);
    m.props.initial = book('replacement'); flushSync(); click(m.target, 'Reload');
    release(1, book('fresh-after-swap')); await settle(); expect(m.target.textContent).toContain('fresh-after-swap');
    expect(calls.map(c => c.op)).toEqual(['delete', 'read', 'read']);
  });
  it('rejects old read after a newer nonnull prop and keeps normal current reads live', async () => {
    const m = mount(); await banner(m); click(m.target, 'Reload');
    m.props.initial = book('new-prop'); flushSync(); release(0, book()); await settle();
    expect(m.target.textContent).toContain('new-prop'); expect(m.target.textContent).not.toContain('old-role');
    click(m.target, 'Reload'); release(1, book('current-read')); await settle(); expect(m.target.textContent).toContain('current-read');
  });
  it.each(['null', 'nonnull', 'error'] as const)('latest issued read owns its %s outcome even when old success finishes last', async kind => {
    const m = mount(); await banner(m); click(m.target, 'Reload'); click(m.target, 'Reload'); expect(reads).toHaveLength(2);
    if (kind === 'error') reads[1].resolve(reply({ error: 'Current read failed' }, false)); else release(1, kind === 'null' ? null : book('newest'));
    await settle(); if (kind === 'null') concealed(m); else if (kind === 'nonnull') expect(m.target.textContent).toContain('newest'); else expect(m.target.textContent).toContain('Seed refusal');
    release(0, book()); await settle();
    if (kind === 'null') concealed(m); else if (kind === 'nonnull') { expect(m.target.textContent).toContain('newest'); expect(m.target.textContent).not.toContain('old-role'); } else expect(m.target.textContent).toContain('Seed refusal');
    expect(calls.filter(c => c.op !== 'read')).toHaveLength(1);
  });
  it('keeps B live when A settles before B', async () => {
    const m = mount(); await banner(m); click(m.target, 'Reload'); click(m.target, 'Reload');
    release(0, book('older-A')); await settle(); expect(m.target.textContent).not.toContain('older-A');
    release(1, book('current-B')); await settle(); expect(m.target.textContent).toContain('current-B');
  });
  it('late banner success cannot clear a newer mutation refusal', async () => {
    const m = mount(); await banner(m); click(m.target, 'Reload');
    mutate = async () => reply({ error: 'New row refusal' }, false);
    click(m.target, 'Delete'); await settle(); expect(m.target.textContent).toContain('New row refusal');
    release(0, book()); await settle(); expect(m.target.textContent).toContain('New row refusal');
  });
  it('a late failed post-write read cannot overwrite a newer save and current read', async () => {
    const m = mount(); mutate = async () => reply({}); click(m.target, 'Delete'); await settle(); expect(reads).toHaveLength(1);
    click(m.target, 'Create rule'); const input = m.target.querySelector<HTMLInputElement>('dialog input:not([type])')!;
    input.value = 'created'; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    click(m.target.querySelector('dialog')!, 'Save'); await settle(); expect(reads).toHaveLength(2);
    release(1, book('current-B')); await settle(); expect(m.target.querySelector('[role=alert]')).toBeNull();
    reads[0].reject(new Error('old network failure')); await settle();
    expect(m.target.textContent).toContain('current-B'); expect(m.target.querySelector('[role=alert]')).toBeNull();
  });
  it.each(['create', 'update'] as const)('defensive programmatic %s reopen is not closed by the old save refresh', async op => {
    const m = mount(); mutate = async () => reply({}); click(m.target, op === 'create' ? 'Create rule' : 'Edit');
    if (op === 'create') { const input = m.target.querySelector<HTMLInputElement>('dialog input:not([type])')!; input.value = 'created'; input.dispatchEvent(new Event('input', { bubbles: true })); }
    click(m.target.querySelector('dialog')!, 'Save'); await settle(); expect(reads).toHaveLength(1);
    // Programmatic callback-boundary probe only: native modal inertness blocks this
    // background Create click in a browser. Do not claim a reachable user interleaving.
    click(m.target, 'Create rule'); const newer = m.target.querySelector('dialog'); expect(newer).not.toBeNull();
    release(0, book('older-refresh')); await settle(); expect(m.target.querySelector('dialog')).toBe(newer);
    expect(calls.map(c => c.op)).toEqual([op, 'read']);
  });
  it.each(['delete', 'unlock'] as const)('old %s finally cannot clear a newer row action busy owner after view replacement', async op => {
    const m = mount({ id: 'config', rules: [{ ...rule, locked: op === 'unlock' }] });
    const a = deferred<Response>(), b = deferred<Response>(); let count = 0; mutate = () => (++count === 1 ? a.promise : b.promise);
    click(m.target, op === 'delete' ? 'Delete' : 'Unlock');
    m.props.initial = { id: 'config', rules: [{ ...rule, role: 'new-row', locked: op === 'unlock' }] }; flushSync();
    expect(button(m.target, op === 'delete' ? 'Delete' : 'Unlock')!.disabled).toBe(false);
    click(m.target, op === 'delete' ? 'Delete' : 'Unlock');
    a.resolve(reply({})); await settle(); expect(reads).toHaveLength(0);
    expect(button(m.target, op === 'delete' ? 'Delete' : 'Unlock')!.disabled).toBe(true);
    b.resolve(reply({})); await settle(); expect(reads).toHaveLength(1); release(0, book('current-row')); await settle();
    expect(button(m.target, 'Delete')!.disabled).toBe(false); expect(calls.filter(c => c.op === op)).toHaveLength(2);
  });
  it('stale conflict Reload cannot remount a newer draft after a newer view', async () => {
    const m = mount(); click(m.target, 'Edit'); click(m.target.querySelector('dialog')!, 'Save'); await settle();
    click(m.target.querySelector('dialog')!, 'Reload the rule (discards your changes)'); expect(reads).toHaveLength(1);
    m.props.initial = null; flushSync(); concealed(m); m.props.initial = book('new-view'); flushSync();
    // The replacement view remounted an idle editor; Cancel it before using background Create.
    click(m.target.querySelector('dialog')!, 'Cancel');
    click(m.target, 'Create rule'); const newer = m.target.querySelector('dialog');
    release(0, book()); await settle(); expect(m.target.querySelector('dialog')).toBe(newer); expect(m.target.textContent).toContain('new-view');
  });
  it('old error after a newer read succeeds leaves that newer book and cleared failure alone', async () => {
    const m = mount(); await banner(m); click(m.target, 'Reload'); click(m.target, 'Reload');
    release(1, book('current-B')); await settle(); expect(m.target.querySelector('[role=alert]')).toBeNull();
    reads[0].reject(new Error('old failure')); await settle(); expect(m.target.textContent).toContain('current-B'); expect(m.target.querySelector('[role=alert]')).toBeNull();
  });
  it.each(['success', 'error'] as const)('obsolete mutation %s launches no refresh into a replacement view', async kind => {
    const m = mount(); const write = deferred<Response>(); mutate = () => write.promise;
    click(m.target, 'Delete'); m.props.initial = book('replacement'); flushSync();
    if (kind === 'success') write.resolve(reply({})); else write.resolve(reply({ error: 'obsolete refusal' }, false));
    await settle(); expect(reads).toHaveLength(0); expect(m.target.textContent).toContain('replacement');
    expect(m.target.querySelector('[role=alert]')).toBeNull(); expect(m.target.textContent).not.toContain('Deleted.'); expect(calls.map(c => c.op)).toEqual(['delete']);
  });
  it('current conflict Reload updates the revision and failure keeps the draft with the existing parent feedback', async () => {
    const m = mount(); click(m.target, 'Edit'); click(m.target.querySelector('dialog')!, 'Save'); await settle();
    const originalEditor = m.target.querySelector('dialog')!;
    click(originalEditor, 'Reload the rule (discards your changes)'); release(0, book('fresh-rule', 2)); await settle();
    expect(m.target.querySelector('dialog')).not.toBe(originalEditor);
    const fresh = m.target.querySelector('dialog')!; expect(fresh.textContent).toContain('Edit rule');
    click(fresh, 'Save'); await settle(); expect(calls.at(-1)?.revision).toBe(2);
    click(fresh, 'Reload the rule (discards your changes)'); reads[1].reject(new Error('current failure')); await settle();
    expect(m.target.querySelector('dialog')).toBe(fresh); expect(m.target.textContent).toContain('Could not reload. Your input is kept.');
    expect(button(fresh, 'Save')!.disabled).toBe(false);
  });
  it.each(['save', 'row'] as const)('current %s success with refresh failure preserves truthful existing outcome and releases pending', async kind => {
    const m = mount(); mutate = async () => reply({});
    if (kind === 'save') { click(m.target, 'Edit'); click(m.target.querySelector('dialog')!, 'Save'); } else click(m.target, 'Delete');
    await settle(); reads[0].reject(new Error('current refresh failed')); await settle();
    expect(m.target.textContent).toContain(kind === 'save' ? 'Saved, but the rules could not be reloaded.' : 'The change succeeded, but the rules could not be reloaded.');
    expect(button(m.target, 'Delete')!.disabled).toBe(false); expect(m.target.querySelector('dialog')).toBeNull();
    expect(calls.map(c => c.op)).toEqual([kind === 'save' ? 'update' : 'delete', 'read']);
  });
  it('returning to the identical initial object is a new view, not permission for an old response', async () => {
    const m = mount(); const original = m.props.initial; await banner(m); click(m.target, 'Reload');
    m.props.initial = null; flushSync(); concealed(m); m.props.initial = original; flushSync();
    release(0, book('obsolete-A')); await settle(); expect(m.target.textContent).toContain('old-role'); expect(m.target.textContent).not.toContain('obsolete-A');
    click(m.target, 'Reload'); release(1, book('live-return')); await settle(); expect(m.target.textContent).toContain('live-return');
  });
  it('late failed conflict Reload does not overwrite replacement-view feedback or a newer editor', async () => {
    const m = mount(); click(m.target, 'Edit'); click(m.target.querySelector('dialog')!, 'Save'); await settle();
    click(m.target.querySelector('dialog')!, 'Reload the rule (discards your changes)');
    m.props.initial = null; flushSync(); concealed(m); m.props.initial = book('replacement'); flushSync();
    click(m.target.querySelector('dialog')!, 'Cancel');
    click(m.target, 'Create rule'); const current = m.target.querySelector('dialog');
    reads[0].reject(new Error('obsolete conflict reload')); await settle();
    expect(m.target.querySelector('dialog')).toBe(current); expect(m.target.textContent).not.toContain('Could not reload. Your input is kept.');
  });
  it.each(['refusal', 'success', 'refresh-held'] as const)('refused Save does not discard an earlier row %s in the same view', async kind => {
    const m = mount(); const row = deferred<Response>();
    mutate = request => request.op === 'delete' ? row.promise : Promise.resolve(reply({ error: 'Save refused' }, false));
    click(m.target, 'Delete');
    if (kind === 'refresh-held') { row.resolve(reply({})); await settle(); expect(reads).toHaveLength(1); }
    click(m.target, 'Create rule'); const dialog = m.target.querySelector('dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('input:not([type])')!;
    input.value = 'draft'; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    click(dialog, 'Save'); await settle(); expect(dialog.textContent).toContain('Save refused');
    if (kind !== 'refresh-held') { row.resolve(kind === 'refusal' ? reply({ error: 'Delete refused' }, false) : reply({})); await settle(); }
    if (kind === 'refusal') { expect(m.target.textContent).toContain('Delete refused'); expect(reads).toHaveLength(0); }
    else { expect(reads).toHaveLength(1); release(0, { id: 'config', rules: [] }); await settle(); if (kind === 'success') expect(m.target.textContent).toContain('Deleted.'); expect(m.target.textContent).not.toContain('old-role'); }
    expect(m.target.querySelector('dialog')).toBe(dialog); expect(dialog.textContent).toContain('Save refused');
    expect(button(dialog, 'Save')!.disabled).toBe(false);
    expect(calls.map(c => c.op)).toEqual(kind === 'refusal' ? ['delete', 'create'] : kind === 'success' ? ['delete', 'create', 'read'] : ['delete', 'read', 'create']);
  });
  it('a newer row read can supersede a save read without stranding its confirmed editor', async () => {
    const m = mount(); const row = deferred<Response>();
    mutate = request => request.op === 'delete' ? row.promise : Promise.resolve(reply({}));
    click(m.target, 'Delete'); click(m.target, 'Create rule'); const dialog = m.target.querySelector('dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('input:not([type])')!;
    input.value = 'created'; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    click(dialog, 'Save'); await settle(); expect(reads).toHaveLength(1);
    row.resolve(reply({})); await settle(); expect(reads).toHaveLength(2);
    release(1, book('latest-row-read')); await settle();
    release(0, book('old-save-read')); await settle();
    expect(m.target.textContent).toContain('latest-row-read'); expect(m.target.textContent).not.toContain('old-save-read');
    expect(m.target.querySelector('dialog')).toBeNull();
    expect(calls.map(c => c.op)).toEqual(['delete', 'create', 'read', 'read']);
  });
  it('a row write completing after teardown issues no read', async () => {
    const old = mount(); const write = deferred<Response>(); mutate = () => write.promise;
    click(old.target, 'Delete'); old.unmount(); const fresh = mount(null);
    write.resolve(reply({})); await settle(); concealed(fresh);
    expect(calls.map(c => c.op)).toEqual(['delete']);
  });
  it('pending Save stays single-flight and current completion releases its own editor', async () => {
    const m = mount(); const write = deferred<Response>(); mutate = () => write.promise; click(m.target, 'Edit');
    const dialog = m.target.querySelector('dialog')!; click(dialog, 'Save');
    expect(button(dialog, 'Saving…')).toBeDefined(); button(dialog, 'Saving…')!.click(); flushSync();
    expect(calls.map(c => c.op)).toEqual(['update']); expect(button(dialog, 'Cancel')!.disabled).toBe(true);
    write.resolve(reply({})); await settle(); release(0, book('current')); await settle();
    expect(m.target.querySelector('dialog')).toBeNull(); expect(calls.map(c => c.op)).toEqual(['update', 'read']);
  });
  it.each(['success', 'error'] as const)('teardown rejects old %s without changing a fresh null instance', async kind => {
    const old = mount(); await banner(old); click(old.target, 'Reload'); old.unmount(); const fresh = mount(null);
    if (kind === 'success') release(0, book()); else reads[0].reject(new Error('late teardown failure'));
    await settle(); concealed(fresh); expect(document.querySelector('[role=alert]')).toBeNull();
  });
});
